import type { QueryClient } from '@tanstack/react-query'

import { getStoredDashboardOrganizationId } from '@/lib/dashboard-scope-storage'

export { getStoredDashboardOrganizationId }

type RouteQueryOptions = Parameters<QueryClient['prefetchQuery']>[0]

export async function ensureRouteQueries(
  queryClient: QueryClient,
  queries: Array<unknown | null | undefined>,
) {
  await Promise.all(
    queries
      .filter((query) => query != null)
      .map((query) => {
        // oxlint-disable-next-line typescript/consistent-type-assertions -- TanStack queryOptions returns specific option types that QueryClient accepts at runtime through its generic overloads.
        return queryClient.ensureQueryData(query as RouteQueryOptions)
      }),
  )
}

export async function prewarmRouteQueries(
  queryClient: QueryClient,
  queries: Array<unknown | null | undefined>,
) {
  await Promise.all(
    queries
      .filter((query) => query != null)
      .map((query) => {
        // oxlint-disable-next-line typescript/consistent-type-assertions -- TanStack queryOptions returns specific option types that QueryClient accepts at runtime through its generic overloads.
        return queryClient.prefetchQuery(query as RouteQueryOptions)
      }),
  )
}

type RouteQueryList = Array<unknown | null | undefined>

/**
 * One declaration of what a route needs from the cache, as the pair every route
 * wants: `load` (the loader awaits it before the page renders) and `prewarm`
 * (hover/focus fetches it ahead of the click). Both read the same list, so a
 * query added for the page cannot be missed by the prewarm, nor the reverse.
 */
export function routeData<Args extends unknown[]>(
  queries: (...args: Args) => RouteQueryList | Promise<RouteQueryList>,
) {
  return {
    load: async (queryClient: QueryClient, ...args: Args) => {
      await ensureRouteQueries(queryClient, await queries(...args))
    },
    prewarm: async (queryClient: QueryClient, ...args: Args) => {
      await prewarmRouteQueries(queryClient, await queries(...args))
    },
  }
}

export async function getStableDashboardOrganizationIdForRouteData() {
  return getStoredDashboardOrganizationId()
}

export function routeLocationToUrl(location: { href: string }) {
  return new URL(location.href, 'https://app.calibrafacil.local')
}
