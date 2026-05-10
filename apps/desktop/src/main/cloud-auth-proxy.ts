import { Buffer } from "node:buffer";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomBytes } from "node:crypto";
import type {
  DesktopAuthFetchRequest,
  DesktopAuthFetchResponse,
} from "@calibra-facil/contracts";

const DEFAULT_PROXY_HOST = "127.0.0.1";

export type DesktopCloudAuthProxyOptions = {
  targetBaseUrl: string;
  authFetch(
    request: DesktopAuthFetchRequest,
  ): Promise<DesktopAuthFetchResponse>;
  host?: string;
  port?: number;
  token?: string;
};

export class DesktopCloudAuthProxy {
  readonly host: string;
  readonly port: number;
  readonly token: string;

  #server: ReturnType<typeof createServer> | null = null;
  #boundPort: number | null = null;
  #targetBaseUrl: string;
  #authFetch: DesktopCloudAuthProxyOptions["authFetch"];

  constructor(options: DesktopCloudAuthProxyOptions) {
    this.host = options.host ?? DEFAULT_PROXY_HOST;
    this.port = options.port ?? 0;
    this.token = options.token ?? randomBytes(32).toString("base64url");
    this.#targetBaseUrl = options.targetBaseUrl;
    this.#authFetch = options.authFetch;
  }

  get baseUrl() {
    if (this.#boundPort === null) {
      throw new Error("Desktop cloud auth proxy is not running.");
    }

    return `http://${this.host}:${this.#boundPort}`;
  }

  async start() {
    if (this.#server) return this.baseUrl;

    this.#server = createServer((request, response) => {
      void this.#handleRequest(request, response);
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        this.#server?.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        this.#server?.off("error", onError);
        const address = this.#server?.address();
        if (!address || typeof address === "string") {
          reject(new Error("Desktop cloud auth proxy did not bind to TCP."));
          return;
        }

        this.#boundPort = address.port;
        resolve();
      };

      this.#server?.once("error", onError);
      this.#server?.once("listening", onListening);
      this.#server?.listen(this.port, this.host);
    });

    return this.baseUrl;
  }

  stop() {
    if (!this.#server) return;
    this.#server.close();
    this.#server = null;
    this.#boundPort = null;
  }

  async #handleRequest(request: IncomingMessage, response: ServerResponse) {
    try {
      if (!isLoopbackAddress(request.socket.remoteAddress)) {
        writeJson(response, 403, { error: "Forbidden" });
        return;
      }

      if (
        request.headers["x-calibra-desktop-cloud-proxy-token"] !== this.token
      ) {
        writeJson(response, 401, { error: "Unauthorized" });
        return;
      }

      const requestUrl = new URL(request.url ?? "/", this.#targetBaseUrl);
      if (!requestUrl.pathname.startsWith("/api/sync/")) {
        writeJson(response, 404, { error: "Not found" });
        return;
      }

      const body = await readRequestBody(request);
      const forwarded = await this.#authFetch({
        url: requestUrl.toString(),
        method: request.method ?? "GET",
        headers: readForwardableHeaders(request),
        body:
          body.length === 0
            ? null
            : {
                encoding: "base64",
                data: body.toString("base64"),
              },
      });

      response.statusCode = forwarded.status;
      response.statusMessage = forwarded.statusText;
      for (const [name, value] of forwarded.headers) {
        if (isHopByHopResponseHeader(name)) continue;
        response.setHeader(name, value);
      }
      response.end(forwarded.body);
    } catch (error) {
      writeJson(response, 502, {
        error:
          error instanceof Error
            ? error.message
            : "Desktop cloud proxy request failed",
      });
    }
  }
}

function readForwardableHeaders(request: IncomingMessage) {
  const headers: Array<[string, string]> = [];

  for (const [name, value] of Object.entries(request.headers)) {
    if (name.toLowerCase() === "x-calibra-desktop-cloud-proxy-token") {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) headers.push([name, item]);
    } else if (typeof value === "string") {
      headers.push([name, value]);
    }
  }

  return headers;
}

function readRequestBody(request: IncomingMessage) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    request.on("error", reject);
    request.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function isLoopbackAddress(address: string | undefined) {
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1"
  );
}

function isHopByHopResponseHeader(name: string) {
  return [
    "connection",
    "content-encoding",
    "content-length",
    "set-cookie",
    "transfer-encoding",
  ].includes(name.toLowerCase());
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  body: Record<string, unknown>,
) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(body));
}
