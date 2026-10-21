import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";

import { portalQueryKey } from "./portal-query-keys";
import type { PortalQueryKeyBuilder } from "./portal-query-keys";

const PortalOrgContext = createContext<string | null>(null);

/**
 * Publishes the active client organization to the authenticated portal tree
 * so query hooks can scope their cache keys to it.
 */
export function PortalOrgProvider({
  organizationId,
  children,
}: {
  organizationId: string | null;
  children: ReactNode;
}) {
  return (
    <PortalOrgContext.Provider value={organizationId}>
      {children}
    </PortalOrgContext.Provider>
  );
}

export function usePortalOrgId(): string | null {
  return useContext(PortalOrgContext);
}

/**
 * Returns the single key factory for portal queries: the result is always
 * prefixed with the active organization, for `useQuery` and for
 * `invalidateQueries` prefixes alike.
 */
export function usePortalQueryKey(): PortalQueryKeyBuilder {
  const organizationId = usePortalOrgId();
  return useMemo(
    () =>
      (...parts) =>
        portalQueryKey(organizationId, ...parts),
    [organizationId],
  );
}
