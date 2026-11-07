import {
  buildEndpointRequest,
  endpointLabel,
  endpointRequestUrl,
  requestTarget,
  type EndpointClientInput,
  type EndpointDef,
  type EndpointGroup,
  type EndpointResponse,
  PORTAL_ENDPOINT_GROUPS,
} from "@calibra-facil/contracts";

import { fetchPortalJson, getApiBaseUrl, jsonInit } from "./api-fetch";

/**
 * The portal's typed calls, derived from the endpoint definitions of
 * `@calibra-facil/contracts` (`PORTAL_ENDPOINT_GROUPS`): the path, the method,
 * the query, the body and the response schema are declared once there, and the
 * API mounts its handlers against the same definitions.
 *
 * It is the portal's own transport (raw `fetch` with the session cookie, see
 * `fetchPortalJson`), not `endpointClient` of `@calibra-facil/client-runtime`:
 * the portal does not depend on that package (docs/architecture/portal-frontend.md).
 * Only the pure request builder (`buildEndpointRequest`, how a definition and
 * an input become a path and a query string) is shared, so a call cannot be
 * turned into a URL differently here and in the lab SDK.
 *
 *     const overview = await portalApi.dashboard.overview();
 *     const { data } = await portalApi.assets.list({ query: { page: 2 } });
 *     await portalApi.visits.confirm({ params: { id: visitId } });

 */

type PortalCallOptions = {
  /**
   * Show the API's own message (`error`, else `message`) instead of the
   * definition's `failure` when the error body carries one. Set where the API
   * explains something the customer can act on (a refused action).
   */
  serverErrorMessage?: boolean;
};

type PortalCallArgs<TDef extends EndpointDef> =
  Record<never, never> extends EndpointClientInput<TDef>
    ? [input?: EndpointClientInput<TDef>, options?: PortalCallOptions]
    : [input: EndpointClientInput<TDef>, options?: PortalCallOptions];

type PortalMethod<TDef extends EndpointDef> = (
  ...args: PortalCallArgs<TDef>
) => Promise<EndpointResponse<TDef>>;

type PortalClient<TGroup extends EndpointGroup> = {
  [Name in keyof TGroup]: PortalMethod<TGroup[Name]>;
};

async function callPortalEndpoint(
  def: EndpointDef,
  input: unknown,
  options: PortalCallOptions | undefined,
) {
  const request = buildEndpointRequest(def, input);
  return fetchPortalJson(requestTarget(request), def.response, {
    errorMessage: def.failure,
    serverErrorMessage: options?.serverErrorMessage,
    contractLabel: endpointLabel(def),
    init:
      request.method === "GET"
        ? undefined
        : jsonInit(request.method, request.body),
  });
}

type PortalClients<TGroups extends Record<string, EndpointGroup>> = {
  [Namespace in keyof TGroups]: PortalClient<TGroups[Namespace]>;
};

function createPortalClients<
  const TGroups extends Record<string, EndpointGroup>,
>(groups: TGroups): PortalClients<TGroups> {
  const clients: Record<string, Record<string, unknown>> = {};
  for (const [namespace, group] of Object.entries(groups)) {
    const methods: Record<string, unknown> = {};
    for (const [name, def] of Object.entries(group)) {
      methods[name] = (input?: unknown, options?: PortalCallOptions) =>
        callPortalEndpoint(def, input, options);
    }
    clients[namespace] = methods;
  }
  return asPortalClients<TGroups>(clients);
}

function asPortalClients<TGroups extends Record<string, EndpointGroup>>(
  clients: Record<string, Record<string, unknown>>,
): PortalClients<TGroups> {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- the single trust point of the portal client: `clients` holds one function per definition of each group, each returning the definition's schema-validated response, which is what `PortalClients` computes from the groups.
  return clients as PortalClients<TGroups>;
}

export const portalApi = createPortalClients(PORTAL_ENDPOINT_GROUPS);

/**
 * The URL of a definition for a link the browser opens (a document, not JSON),
 * on the API's origin: `portalEndpointUrl(def, { params: { id } })`.
 */
export function portalEndpointUrl<TDef extends EndpointDef>(
  def: TDef,
  input: EndpointClientInput<TDef>,
): string {
  return `${getApiBaseUrl()}${endpointRequestUrl(def, input)}`;
}
