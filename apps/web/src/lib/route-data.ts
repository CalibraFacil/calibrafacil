import type { QueryClient } from '@tanstack/react-query'

import { getStoredDashboardOrganizationId } from '@/features/dashboard/dashboard-scope-storage'

export { getStoredDashboardOrganizationId }

type RouteQueryOptions = Parameters<QueryClient['prefetchQuery']>[0]

export async function ensureRouteQueries(
  queryClient: QueryClient,
  queries: Array<unknown | null | undefined>,
) {
  await Promise.all(
    queries
      .filter((query) => query != null)
      .map((query) => queryClient.ensureQueryData(query as RouteQueryOptions)),
  )
}

export async function prewarmRouteQueries(
  queryClient: QueryClient,
  queries: Array<unknown | null | undefined>,
) {
  await Promise.all(
    queries
      .filter((query) => query != null)
      .map((query) => queryClient.prefetchQuery(query as RouteQueryOptions)),
  )
}

export async function getStableDashboardOrganizationIdForRouteData() {
  return getStoredDashboardOrganizationId()
}

export function routeLocationToUrl(location: { href: string }) {
  return new URL(location.href, 'https://app.calibrafacil.local')
}
