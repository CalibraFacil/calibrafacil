import type { QueryClient } from '@tanstack/react-query'
import { organization } from '@calibra-facil/auth/client'

import { DASHBOARD_ORG_KEY } from '@calibra-facil/shared/client-storage-keys'

import { DASHBOARD_UNIT_KEY_PREFIX } from '@/app/config/runtime'
import { setStoredDashboardOrganizationId } from '@/lib/dashboard-scope-storage'

/**
 * Tenant scope of the query cache: ONE mechanism, a guaranteed reset.
 *
 * The API resolves the laboratory and the unit from the session and from
 * `x-active-unit-id`, never from a query key, so a key that carried the
 * organization could not make a request answer for it (another tab can change
 * the session's organization under a cached key). What can be guaranteed is
 * the cache itself: every code path that changes the active organization or
 * unit goes through this module, which cancels what is in flight (its answer is
 * for the old scope), applies the switch, and resets every query. Cached data
 * is dropped (nothing of the other laboratory can flash on screen) and the
 * queries on screen fetch again under the new scope.
 *
 * Another tab of the lab app is a code path too: it writes the stored
 * organization / unit on every switch, and `watchOtherTabScope` below turns that
 * `storage` event into the same reset in the tabs that did not switch.
 *
 * `organization.setActive` is called nowhere else (`switch-scope.test.ts`
 * enforces it), and sign-out / organization deletion call `queryClient.clear()`
 * on their own, since nothing may outlive the session.
 *
 * List keys still embed the organization id: that is only the scope of their
 * `placeholderData` (`keepPreviousDataInScope`), not the tenant guard.
 */
export async function switchScope<T>(
  queryClient: QueryClient,
  apply: () => Promise<T> | T,
  /** False when `apply` resolved without switching: the cache is kept. */
  switched: (result: T) => boolean = () => true,
): Promise<T> {
  await queryClient.cancelQueries()
  const result = await apply()
  if (switched(result)) await queryClient.resetQueries()
  return result
}

/**
 * Make `organizationId` the active laboratory: sets it on the session, remembers
 * it for the dashboard and resets the cache. Resolves with the auth client's own
 * result so a caller can report `error`; a refused switch leaves the session and
 * the cache as they were.
 */
export function switchActiveOrganization(
  queryClient: QueryClient,
  organizationId: string,
) {
  return switchScope(
    queryClient,
    async () => {
      const result = await organization.setActive({ organizationId })
      if (!result.error) setStoredDashboardOrganizationId(organizationId)
      return result
    },
    (result) => !result.error,
  )
}

/**
 * Follow the organization / unit another tab of this browser switched to.
 *
 * Every switch writes `dashboard-active-org` or `dashboard-active-unit:<org>`
 * to `localStorage` (after the session already names the new organization), and
 * the browser fires a `storage` event in the OTHER tabs only. This tab's cache
 * still holds the old scope and the API would answer its next request for the
 * new one, so it resets exactly as a switch made here does. An organization
 * change also re-applies the choice to this tab's own session atom (the same
 * `setActive` the other tab already did, so the API answer does not change):
 * that is what refreshes the organization the shell shows.
 *
 * Returns the function that stops listening.
 */
export function watchOtherTabScope(
  queryClient: QueryClient,
  target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window,
): () => void {
  const onStorage = (event: Event) => {
    if (!(event instanceof StorageEvent)) return
    const { key, newValue } = event
    if (!key || !newValue) return
    if (key === DASHBOARD_ORG_KEY) {
      void switchScope(queryClient, async () => {
        try {
          await organization.setActive({ organizationId: newValue })
        } catch {
          // The cache is stale either way; the reset below still runs.
        }
      })
    } else if (key.startsWith(DASHBOARD_UNIT_KEY_PREFIX)) {
      void switchScope(queryClient, () => undefined)
    }
  }
  target.addEventListener('storage', onStorage)
  return () => target.removeEventListener('storage', onStorage)
}
