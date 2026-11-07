import type { QueryClient } from '@tanstack/react-query'
import { organization } from '@calibra-facil/auth/client'

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
