import type { QueryClient } from '@tanstack/react-query'

/**
 * Switch the active laboratory or unit (roadmap 2 F2, review 3.5).
 *
 * The query keys do not carry the organization or the unit (the API resolves
 * them from the session and `x-active-unit-id`), so after a switch every cached
 * result belongs to the previous scope. Requests in flight are cancelled (their
 * answer is for the old scope), the switch is applied, and every query is
 * reset: cached data is dropped (nothing of the other laboratory can flash on
 * screen) and the queries on screen fetch again under the new scope.
 */
export async function switchScope(
  queryClient: QueryClient,
  apply: () => Promise<void> | void,
): Promise<void> {
  await queryClient.cancelQueries()
  await apply()
  await queryClient.resetQueries()
}
