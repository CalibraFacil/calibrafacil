import {
  endpointLabel,
  validateResponsePayload,
  type EndpointClientInput,
  type EndpointDef,
  type EndpointGroup,
  type EndpointResponse,
  type ResponseValidationOptions,
} from "@calibra-facil/contracts";

import { createCloudHeaders, type CreateCloudApiClientOptions } from "./cloud";
import {
  createDesktopHeaders,
  type CreateDesktopApiClientOptions,
} from "./desktop";
import { readJsonResponse } from "./response";

/**
 * The generic client of the endpoint definitions (`@calibra-facil/contracts`,
 * `endpoints/`). A definition becomes a typed method `(input) => Promise<response>`
 * where `input` is `{ params, query, body }` (each present only when the
 * endpoint has that part). What it adds to an HTTP call is exactly what the
 * hand-written modules did, once:
 *
 * - the request goes through an {@link EndpointTransport}: the cloud one adds
 *   the credentials and the active-unit header, the desktop one the local
 *   server's bearer token (the cloud-vs-desktop switch stays in the transport);
 * - a non-2xx answer is a `CalibraApiError` (`readJsonResponse`: the body's
 *   `error` text, else the definition's `failure`, status and payload kept);
 * - a 2xx body is parsed with the definition's response schema
 *   (`validateResponsePayload`: strict in development/tests, warn in production).
 */

type EndpointRequest = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** The path with its parameters filled in (and encoded). */
  path: string;
  /** Scalars already serialised; `undefined` entries are dropped. */
  query: URLSearchParams;
  /** JSON-serialisable body; absent for a request without one. */
  body: unknown;
};

export type EndpointTransport = (request: EndpointRequest) => Promise<Response>;

type EndpointArgs<TDef extends EndpointDef> =
  Record<never, never> extends EndpointClientInput<TDef>
    ? [input?: EndpointClientInput<TDef>]
    : [input: EndpointClientInput<TDef>];

type EndpointMethodOf<TDef extends EndpointDef> = (
  ...args: EndpointArgs<TDef>
) => Promise<EndpointResponse<TDef>>;

export type EndpointClient<TGroup extends EndpointGroup> = {
  [Name in keyof TGroup]: EndpointMethodOf<TGroup[Name]>;
};

export function endpointClient<const TGroup extends EndpointGroup>(
  group: TGroup,
  transport: EndpointTransport,
  options: ResponseValidationOptions = {},
): EndpointClient<TGroup> {
  const methods: Record<string, (input?: unknown) => Promise<unknown>> = {};
  for (const [name, def] of Object.entries(group)) {
    methods[name] = (input) => callEndpoint(def, transport, options, input);
  }
  return asEndpointClient<TGroup>(methods);
}

async function callEndpoint(
  def: EndpointDef,
  transport: EndpointTransport,
  options: ResponseValidationOptions,
  input: unknown,
) {
  const parts = readInput(input);
  const response = await transport({
    method: methodOf(def),
    path: fillPath(def.path, parts.params),
    query: toSearchParams(parts.query),
    body: parts.body,
  });
  const payload = await readJsonResponse<unknown>(response, def.failure);
  return validateResponsePayload(
    def.response,
    payload,
    endpointLabel(def),
    options,
  );
}

function methodOf(def: EndpointDef): EndpointRequest["method"] {
  switch (def.method) {
    case "get":
      return "GET";
    case "post":
      return "POST";
    case "put":
      return "PUT";
    case "patch":
      return "PATCH";
    case "delete":
      return "DELETE";
  }
}

type InputParts = {
  params: Record<string, unknown>;
  query: Record<string, unknown>;
  body: unknown;
};

function readInput(input: unknown): InputParts {
  const record = isRecord(input) ? input : {};
  const params = record.params;
  const query = record.query;
  return {
    params: isRecord(params) ? params : {},
    query: isRecord(query) ? query : {},
    body: record.body,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fillPath(path: string, params: Record<string, unknown>) {
  return path.replace(/:([A-Za-z0-9_]+)/g, (_match, name: string) => {
    const value = params[name];
    if (typeof value !== "string" && typeof value !== "number") {
      throw new Error(`Missing path parameter "${name}" for ${path}`);
    }
    return encodeURIComponent(String(value));
  });
}

function toSearchParams(query: Record<string, unknown>) {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    searchParams.set(key, String(value));
  }
  return searchParams;
}

function asEndpointClient<TGroup extends EndpointGroup>(
  methods: Record<string, (input?: unknown) => Promise<unknown>>,
): EndpointClient<TGroup> {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- the single trust point of the generic client: `methods` holds exactly one function per definition of the group, each returning the definition's schema-validated response, which is what `EndpointClient` computes from the group.
  return methods as EndpointClient<TGroup>;
}

// ---------------------------------------------------------------------------
// Transports
// ---------------------------------------------------------------------------

function withQuery(url: string, query: URLSearchParams) {
  const queryString = query.toString();
  return queryString ? `${url}?${queryString}` : url;
}

function jsonBodyInit(body: unknown) {
  return body === undefined
    ? { body: undefined, contentType: undefined }
    : { body: JSON.stringify(body), contentType: "application/json" };
}

/** The cloud API: credentials always, the active unit as a header. */
export function createCloudEndpointTransport(
  options: CreateCloudApiClientOptions,
): EndpointTransport {
  const fetchImpl = options.fetch ?? fetch;
  const baseUrl = trimTrailingSlashes(options.baseUrl);

  return async (request) => {
    const headers = createCloudHeaders(options.activeUnitProvider);
    const { body, contentType } = jsonBodyInit(request.body);
    if (contentType) headers.set("Content-Type", contentType);

    return fetchImpl(withQuery(`${baseUrl}${request.path}`, request.query), {
      body: request.method === "GET" ? undefined : body,
      method: request.method,
      credentials: "include",
      headers,
    });
  };
}

/** The desktop's local server: the bearer token of the session. */
export function createDesktopEndpointTransport(
  options: CreateDesktopApiClientOptions,
): EndpointTransport {
  const fetchImpl = options.fetch ?? fetch;

  return async (request) => {
    const url = new URL(request.path, options.baseUrl);
    request.query.forEach((value, key) => url.searchParams.set(key, value));
    const { body, contentType } = jsonBodyInit(request.body);
    const headers = await createDesktopHeaders(options.tokenProvider);
    if (contentType) headers.set("Content-Type", contentType);

    return fetchImpl(url, {
      method: request.method,
      credentials: "include",
      headers,
      body: request.method === "GET" ? undefined : body,
    });
  };
}

/** The URL without its trailing slashes; a loop, not a regex (linear on any input). */
function trimTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === "/") end -= 1;
  return url.slice(0, end);
}
