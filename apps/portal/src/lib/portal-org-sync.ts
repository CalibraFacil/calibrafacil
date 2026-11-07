import type { QueryClient } from "@tanstack/react-query";
import { PORTAL_ORG_KEY } from "@calibra-facil/shared/client-storage-keys";

import { cancelPortalQueries, removePortalQueries } from "./portal-query-keys";

/**
 * Follow the client organization another tab of this browser switched to.
 *
 * The switcher stores `portal-active-org` after the session already names the
 * new organization, and the browser fires a `storage` event in the OTHER tabs
 * only. Such a tab keeps rendering (and keying its cache under) the old
 * organization while the API answers for the new one, so it does what a switch
 * made here does: cancel what is in flight, re-apply the choice to its own
 * session atom (`setActive`: the session already names it, so the API answer
 * does not change, but the atom behind the organization context refreshes) and
 * drop the other organizations' entries.
 *
 * Returns the function that stops listening.
 */
export function watchOtherTabOrganization(
  queryClient: QueryClient,
  setActive: (input: { organizationId: string }) => Promise<unknown>,
  target: Pick<Window, "addEventListener" | "removeEventListener"> = window,
): () => void {
  const onStorage = (event: Event) => {
    if (!(event instanceof StorageEvent)) return;
    const { key, newValue } = event;
    if (key !== PORTAL_ORG_KEY || !newValue) return;
    void (async () => {
      await cancelPortalQueries(queryClient);
      try {
        await setActive({ organizationId: newValue });
      } catch {
        // The stored choice is the other tab's, which already switched the
        // session: the cache is stale either way.
      }
      removePortalQueries(queryClient, newValue);
    })();
  };
  target.addEventListener("storage", onStorage);
  return () => target.removeEventListener("storage", onStorage);
}
