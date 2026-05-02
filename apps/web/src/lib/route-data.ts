import type { QueryClient } from '@tanstack/react-query'

const DASHBOARD_ORG_KEY = 'dashboard-active-org'

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

export function getStoredDashboardOrganizationId() {
  if (typeof window === 'undefined') return null

  return window.localStorage.getItem(DASHBOARD_ORG_KEY)
}

export async function getStableDashboardOrganizationIdForRouteData() {
  return getStoredDashboardOrganizationId()
}
