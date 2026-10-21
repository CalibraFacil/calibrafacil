import type { QueryClient } from "@tanstack/react-query";

/**
 * Every authenticated portal query is cached under the active client
 * organization. The portal API answers for whichever organization the session
 * names, so a key without the org id would let one org's response be served to
 * another after a switch. Build keys only through this helper.
 */

/** First segment shared by every key built with `portalQueryKey`. */
export const PORTAL_QUERY_ROOT = "portal";

const NO_ORGANIZATION = "no-organization";

export function portalQueryKey(
  organizationId: string | null,
  ...parts: ReadonlyArray<unknown>
): ReadonlyArray<unknown> {
  return [PORTAL_QUERY_ROOT, organizationId ?? NO_ORGANIZATION, ...parts];
}

export type PortalQueryKeyBuilder = (
  ...parts: ReadonlyArray<unknown>
) => ReadonlyArray<unknown>;

/**
 * Stops every in-flight portal request, so a response for the organization
 * being left cannot land in the cache after the switch.
 */
export function cancelPortalQueries(queryClient: QueryClient) {
  return queryClient.cancelQueries({ queryKey: [PORTAL_QUERY_ROOT] });
}

/**
 * Drops every cached portal entry that does not belong to
 * `keepOrganizationId` (the organization being switched to).
 */
export function removePortalQueries(
  queryClient: QueryClient,
  keepOrganizationId: string,
) {
  queryClient.removeQueries({
    predicate: (query) =>
      query.queryKey[0] === PORTAL_QUERY_ROOT &&
      query.queryKey[1] !== keepOrganizationId,
  });
}
