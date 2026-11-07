import { isRecord } from "@calibra-facil/shared/record";

import type { EndpointDef } from "./define";

/**
 * The HTTP request an endpoint definition and a caller's input make: the one
 * place `:name` path parameters are filled and the query is serialised, shared
 * by every client of the definitions (the SDK's `endpointClient` in
 * `client-runtime` and the portal's own transport), so the two cannot disagree
 * on how a call becomes a URL.
 */
export type EndpointRequest = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** The path with its parameters filled in (and encoded). */
  path: string;
  /** Scalars serialised with `String()` (an array becomes `a,b`); `undefined` and `null` entries are dropped. */
  query: URLSearchParams;
  /** JSON-serialisable body; absent for a request without one. */
  body: unknown;
};

/** The `{ params, query, body }` object of a call (the type is `EndpointClientInput`). */
export function buildEndpointRequest(
  def: Pick<EndpointDef, "method" | "path">,
  input: unknown,
): EndpointRequest {
  const record = isRecord(input) ? input : {};
  const params = isRecord(record.params) ? record.params : {};
  const query = isRecord(record.query) ? record.query : {};
  return {
    method: methodOf(def),
    path: fillPath(def.path, params),
    query: toSearchParams(query),
    body: record.body,
  };
}

/** `path?query` of a request: what goes after the API's origin. */
export function requestTarget({ path, query }: EndpointRequest): string {
  const queryString = query.toString();
  return queryString ? `${path}?${queryString}` : path;
}

/** The target of a call for a link the browser opens (a document download). */
export function endpointRequestUrl(
  def: Pick<EndpointDef, "method" | "path">,
  input: unknown,
): string {
  return requestTarget(buildEndpointRequest(def, input));
}

function methodOf(def: Pick<EndpointDef, "method">): EndpointRequest["method"] {
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
