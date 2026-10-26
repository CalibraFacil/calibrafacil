import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import {
  checkOutboundUrl,
  judgeOutboundAddress,
  normalizeHostname,
  readOutboundPolicy,
  type OutboundPolicy,
} from "./outbound-policy";

/**
 * `fetch` for a URL somebody else configured (a webhook target, an ERP base
 * URL). Plain `fetch` follows redirects, trusts DNS and reads whatever comes
 * back, so a configured URL could reach the internal network (Postgres, the
 * object store, the PDF service, the cloud metadata address) and a response
 * could be exfiltrated or exhaust memory. This helper:
 *
 *  - allows `https:` only in production (`OUTBOUND_ALLOW_INSECURE_HTTP`
 *    reopens `http:`; outside production it is always allowed);
 *  - resolves the host ONCE and refuses the request when ANY resolved address
 *    is private, loopback, link-local, CGNAT, unique-local, multicast,
 *    unspecified, reserved, or an IPv6 form wrapping one of those;
 *  - connects to the address it validated (the socket is opened on the IP, the
 *    TLS handshake and the `Host` header still name the host), so DNS cannot
 *    answer differently between the check and the connection (rebinding);
 *  - does not follow redirects by default (`maxRedirects: 0`: the 3xx comes
 *    back as the response); with a limit, every hop is validated like the first;
 *  - bounds the total time and the time to connect;
 *  - streams the response and stops reading at `maxResponseBytes`.
 *
 * An operator can allow a host that resolves privately (an ERP on the LAN)
 * with `OUTBOUND_ALLOW_PRIVATE_HOSTS`.
 *
 * Pinning works the same under Bun and Node: it rides on `node:http(s)` with
 * `host: <ip>` and `servername: <host>`, which both runtimes implement, not on
 * a per-runtime `fetch` extension (`dispatcher` is undici-only; Bun has none).
 */

export type OutboundFailureCode =
  | "invalid_url"
  | "blocked_address"
  | "dns_failed"
  | "timeout"
  | "response_too_large"
  | "too_many_redirects"
  | "network";

export class OutboundRequestError extends Error {
  readonly code: OutboundFailureCode;

  constructor(code: OutboundFailureCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "OutboundRequestError";
    this.code = code;
  }
}

export interface ResolvedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

/** Resolves every address of a host (`getaddrinfo` with `all: true`). */
export type HostResolver = (
  hostname: string,
) => Promise<readonly ResolvedAddress[]>;

export interface RawOutboundResponse {
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
  readonly body: Uint8Array<ArrayBuffer>;
}

/** One request to one validated address. Replaceable so tests need no network. */
export interface PinnedRequest {
  readonly url: URL;
  readonly address: ResolvedAddress;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array | undefined;
  readonly maxResponseBytes: number;
  readonly onOversize: "throw" | "truncate";
  readonly connectTimeoutMs: number;
  readonly signal: AbortSignal;
}

export type PinnedTransport = (
  request: PinnedRequest,
) => Promise<RawOutboundResponse>;

export interface SafeOutboundOptions {
  /** Default: the deployment's policy (`readOutboundPolicy()`). */
  readonly policy?: OutboundPolicy;
  /** Total time for the call, DNS and redirects included. Default 10 s. */
  readonly timeoutMs?: number;
  /** Time to open the connection (per address). Default 5 s. */
  readonly connectTimeoutMs?: number;
  /** Largest response body read. Default 64 KiB. */
  readonly maxResponseBytes?: number;
  /**
   * What a larger body does: `throw` an `OutboundRequestError`
   * (`response_too_large`, the default: a cut JSON document is no document) or
   * `truncate` it (a webhook answer is only kept as a snippet).
   */
  readonly onOversize?: "throw" | "truncate";
  /** Redirects followed, each re-validated. Default 0: a 3xx is returned. */
  readonly maxRedirects?: number;
  readonly signal?: AbortSignal;
  readonly resolver?: HostResolver;
  readonly transport?: PinnedTransport;
}

export const DEFAULT_OUTBOUND_TIMEOUT_MS = 10_000;
export const DEFAULT_OUTBOUND_CONNECT_TIMEOUT_MS = 5_000;
export const DEFAULT_OUTBOUND_MAX_RESPONSE_BYTES = 64 * 1024;

export type SafeOutboundInit = {
  method?: string;
  headers?: HeadersInit;
  body?: string | Uint8Array | ArrayBuffer | URLSearchParams | null;
};

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);
const HOP_BY_HOP_HEADERS = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "keep-alive",
  "upgrade",
]);
const CREDENTIAL_HEADERS = new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
]);

export async function resolveHostAddresses(
  hostname: string,
): Promise<readonly ResolvedAddress[]> {
  const found = await lookup(hostname, { all: true, verbatim: true });
  return found.flatMap((entry) =>
    entry.family === 4 || entry.family === 6
      ? [{ address: entry.address, family: entry.family }]
      : [],
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function encodeBody(init: SafeOutboundInit): {
  bytes: Uint8Array | undefined;
  contentType: string | undefined;
} {
  const body = init.body;
  if (body === undefined || body === null) {
    return { bytes: undefined, contentType: undefined };
  }
  if (typeof body === "string") {
    return { bytes: new TextEncoder().encode(body), contentType: undefined };
  }
  if (body instanceof URLSearchParams) {
    return {
      bytes: new TextEncoder().encode(body.toString()),
      contentType: "application/x-www-form-urlencoded;charset=UTF-8",
    };
  }
  if (body instanceof ArrayBuffer) {
    return { bytes: new Uint8Array(body), contentType: undefined };
  }
  return { bytes: body, contentType: undefined };
}

function buildHeaders(
  init: SafeOutboundInit,
  contentType: string | undefined,
  bodyLength: number | undefined,
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of new Headers(init.headers).entries()) {
    if (!HOP_BY_HOP_HEADERS.has(name)) headers[name] = value;
  }
  headers["accept-encoding"] ??= "identity";
  headers["user-agent"] ??= "CalibraFacil/1.0";
  if (contentType !== undefined) headers["content-type"] ??= contentType;
  if (bodyLength !== undefined) headers["content-length"] = String(bodyLength);
  return headers;
}

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/** The `node:http(s)` transport: connects to the pinned IP, names the host. */
export const nodePinnedTransport: PinnedTransport = (request) =>
  new Promise<RawOutboundResponse>((resolve, reject) => {
    const { url, address } = request;
    const secure = url.protocol === "https:";
    const hostname = normalizeHostname(url.hostname);
    let connectTimer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;

    const finish = (run: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      request.signal.removeEventListener("abort", onAbort);
      run();
    };

    const clientRequest = (secure ? https : http).request({
      host: address.address,
      family: address.family,
      port: url.port === "" ? (secure ? 443 : 80) : Number(url.port),
      method: request.method,
      path: `${url.pathname}${url.search}`,
      headers: { ...request.headers, host: url.host },
      // The certificate is checked against the NAME, while the socket goes to
      // the validated address.
      servername: secure && isIP(hostname) === 0 ? hostname : undefined,
      agent: false,
    });

    const fail = (error: unknown) => {
      finish(() => {
        clientRequest.destroy();
        reject(
          error instanceof OutboundRequestError
            ? error
            : new OutboundRequestError(
                "network",
                `Falha de conexão: ${describe(error)}`,
                error,
              ),
        );
      });
    };

    function onAbort() {
      fail(request.signal.reason);
    }
    request.signal.addEventListener("abort", onAbort, { once: true });

    clientRequest.on("socket", (socket) => {
      connectTimer = setTimeout(() => {
        fail(
          new OutboundRequestError(
            "timeout",
            "Tempo esgotado ao conectar com o destino",
          ),
        );
      }, request.connectTimeoutMs);
      const connected = () => clearTimeout(connectTimer);
      if (!socket.connecting) connected();
      else socket.once(secure ? "secureConnect" : "connect", connected);
    });
    clientRequest.on("error", fail);

    clientRequest.on("response", (response) => {
      clearTimeout(connectTimer);
      const chunks: Buffer[] = [];
      let received = 0;
      let truncated = false;

      const complete = () => {
        finish(() => {
          const headers = new Headers();
          for (
            let index = 0;
            index + 1 < response.rawHeaders.length;
            index += 2
          ) {
            try {
              headers.append(
                response.rawHeaders[index] ?? "",
                response.rawHeaders[index + 1] ?? "",
              );
            } catch {
              // A header Headers refuses is not one a caller needs.
            }
          }
          resolve({
            status: response.statusCode ?? 0,
            statusText: response.statusMessage ?? "",
            headers,
            body: truncated
              ? new Uint8Array(
                  Buffer.concat(chunks).subarray(0, request.maxResponseBytes),
                )
              : new Uint8Array(Buffer.concat(chunks)),
          });
        });
      };

      const declared = Number(response.headers["content-length"]);
      if (
        request.onOversize === "throw" &&
        Number.isFinite(declared) &&
        declared > request.maxResponseBytes
      ) {
        fail(tooLarge(request.maxResponseBytes));
        return;
      }

      response.on("data", (chunk: Buffer) => {
        if (settled) return;
        received += chunk.length;
        if (received <= request.maxResponseBytes) {
          chunks.push(chunk);
          return;
        }
        if (request.onOversize === "throw") {
          fail(tooLarge(request.maxResponseBytes));
          return;
        }
        // Keep what fits, stop reading: the rest is never buffered.
        chunks.push(chunk);
        truncated = true;
        complete();
        clientRequest.destroy();
      });
      response.on("end", complete);
      response.on("error", fail);
      response.on("aborted", () => {
        fail(new OutboundRequestError("network", "Resposta interrompida"));
      });
    });

    if (request.body !== undefined) clientRequest.write(request.body);
    clientRequest.end();
  });

function tooLarge(limit: number) {
  return new OutboundRequestError(
    "response_too_large",
    `Resposta maior que o limite de ${limit} bytes`,
  );
}

function timeoutError(timeoutMs: number) {
  return new OutboundRequestError(
    "timeout",
    `Tempo esgotado após ${timeoutMs} ms`,
  );
}

async function resolveAndJudge(
  url: URL,
  policy: OutboundPolicy,
  resolver: HostResolver,
  signal: AbortSignal,
): Promise<readonly ResolvedAddress[]> {
  const hostname = normalizeHostname(url.hostname);
  const literal = isIP(hostname);
  let addresses: readonly ResolvedAddress[];
  if (literal !== 0) {
    addresses = [{ address: hostname, family: literal === 4 ? 4 : 6 }];
  } else {
    try {
      addresses = await raceAbort(resolver(hostname), signal);
    } catch (error) {
      if (error instanceof OutboundRequestError || signal.aborted) throw error;
      throw new OutboundRequestError(
        "dns_failed",
        `Não foi possível resolver ${hostname}: ${describe(error)}`,
        error,
      );
    }
    if (addresses.length === 0) {
      throw new OutboundRequestError(
        "dns_failed",
        `Não foi possível resolver ${hostname}`,
      );
    }
  }

  // Every answer must pass: one private address among public ones is a
  // rebinding / split-horizon trick, not a mixed bag to pick from.
  for (const entry of addresses) {
    const verdict = judgeOutboundAddress(policy, hostname, entry.address);
    if (!verdict.allowed) {
      throw new OutboundRequestError(
        "blocked_address",
        `Destino não permitido: ${hostname} resolve para um endereço restrito (${verdict.reason})`,
      );
    }
  }
  return addresses;
}

/**
 * Calls a configured URL. Resolves with a standard `Response` whose body is at
 * most `maxResponseBytes` long. Rejects with `OutboundRequestError`.
 */
export async function safeOutboundFetch(
  input: string | URL,
  init: SafeOutboundInit = {},
  options: SafeOutboundOptions = {},
): Promise<Response> {
  const policy = options.policy ?? readOutboundPolicy();
  const timeoutMs = options.timeoutMs ?? DEFAULT_OUTBOUND_TIMEOUT_MS;
  const connectTimeoutMs =
    options.connectTimeoutMs ?? DEFAULT_OUTBOUND_CONNECT_TIMEOUT_MS;
  const maxResponseBytes =
    options.maxResponseBytes ?? DEFAULT_OUTBOUND_MAX_RESPONSE_BYTES;
  const maxRedirects = options.maxRedirects ?? 0;
  const resolver = options.resolver ?? resolveHostAddresses;
  const transport = options.transport ?? nodePinnedTransport;

  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = options.signal
    ? AbortSignal.any([timeout, options.signal])
    : timeout;

  let method = (init.method ?? "GET").toUpperCase();
  let encoded = encodeBody(init);
  let headers = buildHeaders(init, encoded.contentType, encoded.bytes?.length);
  let current: URL | null = null;
  const abortError = () =>
    options.signal?.aborted ? options.signal.reason : timeoutError(timeoutMs);

  for (let hop = 0; ; hop += 1) {
    const checked = checkOutboundUrl(current ?? input, policy);
    if (!checked.ok) {
      throw new OutboundRequestError(checked.code, checked.reason);
    }
    const url = checked.url;
    current = url;

    let addresses: readonly ResolvedAddress[];
    try {
      // oxlint-disable-next-line eslint/no-await-in-loop -- each redirect hop is validated after the previous response, so the hops are sequential by nature.
      addresses = await resolveAndJudge(url, policy, resolver, signal);
    } catch (error) {
      if (signal.aborted) throw abortError();
      throw error;
    }

    let raw: RawOutboundResponse | null = null;
    let lastError: unknown;
    for (const address of addresses) {
      try {
        // oxlint-disable-next-line eslint/no-await-in-loop -- the next address is only tried when the previous one failed to connect.
        raw = await transport({
          url,
          address,
          method,
          headers,
          body:
            method === "GET" || method === "HEAD" ? undefined : encoded.bytes,
          maxResponseBytes,
          onOversize: options.onOversize ?? "throw",
          connectTimeoutMs,
          signal,
        });
        break;
      } catch (error) {
        lastError = error;
        // Only a failure to reach the address moves on to the next one; a
        // refusal, a timeout or an oversize answer ends the call.
        const retriable =
          error instanceof OutboundRequestError &&
          error.code === "network" &&
          !signal.aborted;
        if (!retriable) break;
      }
    }
    if (!raw) {
      if (signal.aborted) throw abortError();
      throw lastError instanceof OutboundRequestError
        ? lastError
        : new OutboundRequestError(
            "network",
            `Falha de conexão: ${describe(lastError)}`,
            lastError,
          );
    }

    const location = raw.headers.get("location");
    if (REDIRECT_STATUSES.has(raw.status) && location !== null) {
      if (maxRedirects === 0) return toResponse(raw, method);
      if (hop >= maxRedirects) {
        throw new OutboundRequestError(
          "too_many_redirects",
          `Mais de ${maxRedirects} redirecionamentos`,
        );
      }
      let next: URL;
      try {
        next = new URL(location, url);
      } catch {
        throw new OutboundRequestError(
          "invalid_url",
          "Redirecionamento para uma URL inválida",
        );
      }
      // 303 (and 301/302 after a POST) become a GET without a body; 307/308
      // repeat the request as it was.
      if (
        raw.status === 303 ||
        ((raw.status === 301 || raw.status === 302) && method === "POST")
      ) {
        method = method === "HEAD" ? "HEAD" : "GET";
        encoded = { bytes: undefined, contentType: undefined };
        headers = Object.fromEntries(
          Object.entries(headers).filter(
            ([name]) => name !== "content-type" && name !== "content-length",
          ),
        );
      }
      // Credentials never follow a redirect to another origin.
      if (next.origin !== url.origin) {
        headers = Object.fromEntries(
          Object.entries(headers).filter(
            ([name]) => !CREDENTIAL_HEADERS.has(name),
          ),
        );
      }
      current = next;
      continue;
    }

    return toResponse(raw, method);
  }
}

function toResponse(raw: RawOutboundResponse, method: string): Response {
  const nullBody =
    method === "HEAD" ||
    NULL_BODY_STATUSES.has(raw.status) ||
    raw.body.length === 0;
  return new Response(nullBody ? null : raw.body, {
    status: raw.status,
    statusText: raw.statusText,
    headers: raw.headers,
  });
}

/** What a caller that only needs `fetch(url, init)` semantics takes. */
export type OutboundFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

/**
 * An `OutboundFetch` with these options fixed: for the ERP adapters, which
 * take their `fetch` as a dependency.
 */
export function createOutboundFetch(
  options: SafeOutboundOptions = {},
): OutboundFetch {
  return (input, init) => {
    const body = init?.body;
    if (
      body !== undefined &&
      body !== null &&
      typeof body !== "string" &&
      !(body instanceof Uint8Array) &&
      !(body instanceof ArrayBuffer) &&
      !(body instanceof URLSearchParams)
    ) {
      throw new TypeError("safeOutboundFetch: unsupported request body type");
    }
    return safeOutboundFetch(
      input,
      {
        method: init?.method,
        headers: init?.headers,
        body,
      },
      { signal: init?.signal ?? undefined, ...options },
    );
  };
}
