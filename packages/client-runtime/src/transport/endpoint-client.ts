import {
  buildEndpointRequest,
  endpointLabel,
  validateResponsePayload,
  type EndpointClientInput,
  type EndpointDef,
  type EndpointGroup,
  type EndpointRequest,
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

/** The clients of every group, keyed by namespace (`CalibraApi` before its client modules). */
export type EndpointClients<TGroups extends Record<string, EndpointGroup>> = {
  [Namespace in keyof TGroups]: EndpointClient<TGroups[Namespace]>;
};

export function endpointClients<
  const TGroups extends Record<string, EndpointGroup>,
>(
  groups: TGroups,
  transport: EndpointTransport,
  options: ResponseValidationOptions = {},
): EndpointClients<TGroups> {
  const clients: Record<string, unknown> = {};
  for (const [namespace, group] of Object.entries(groups)) {
    clients[namespace] = endpointClient(group, transport, options);
  }
  return asEndpointClients<TGroups>(clients);
}

async function callEndpoint(
  def: EndpointDef,
  transport: EndpointTransport,
  options: ResponseValidationOptions,
  input: unknown,
) {
  const response = await transport(buildEndpointRequest(def, input));
  // A 204 has no body: the definition's response is `noContent`.
  const payload =
    response.status === 204
      ? undefined
      : await readJsonResponse(response, def.failure);
  return validateResponsePayload(
    def.response,
    payload,
    endpointLabel(def),
    options,
  );
}

function asEndpointClient<TGroup extends EndpointGroup>(
  methods: Record<string, (input?: unknown) => Promise<unknown>>,
): EndpointClient<TGroup> {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- the single trust point of the generic client: `methods` holds exactly one function per definition of the group, each returning the definition's schema-validated response, which is what `EndpointClient` computes from the group.
  return methods as EndpointClient<TGroup>;
}

function asEndpointClients<TGroups extends Record<string, EndpointGroup>>(
  clients: Record<string, unknown>,
): EndpointClients<TGroups> {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- one entry per group, each built by `endpointClient` from that group; this is the single trust point tying the runtime map to `EndpointClients`.
  return clients as EndpointClients<TGroups>;
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
