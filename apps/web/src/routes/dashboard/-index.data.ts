import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query'
import type {
  DashboardJob,
  DashboardJobStatus,
  DashboardStats,
} from '@calibra-facil/client-runtime'

import { calibraApi } from '@/utils/api'
import {
  ensureRouteQueries,
  getStableDashboardOrganizationIdForRouteData,
  prewarmRouteQueries,
} from '@/lib/route-data'

export type { DashboardJob, DashboardJobStatus, DashboardStats }

export function dashboardStatsQueryOptions(organizationId: string) {
  return queryOptions({
    queryKey: ['dashboard', 'stats', organizationId],
    queryFn: () => calibraApi.dashboard.getStats(),
    refetchInterval: 60000,
    staleTime: 30000,
  })
}

export async function getDashboardIndexEssentialQueries() {
  const organizationId = await getStableDashboardOrganizationIdForRouteData()
  if (!organizationId) return []

  return [dashboardStatsQueryOptions(organizationId)]
}

export async function loadDashboardIndexData(queryClient: QueryClient) {
  await ensureRouteQueries(
    queryClient,
    await getDashboardIndexEssentialQueries(),
  )
}

export async function prewarmDashboardIndex(queryClient: QueryClient) {
  await prewarmRouteQueries(
    queryClient,
    await getDashboardIndexEssentialQueries(),
  )
}

export function useDashboardIndexData({
  activeOrganizationId,
  enabled,
}: {
  activeOrganizationId: string | null
  enabled: boolean
}) {
  return useQuery({
    ...dashboardStatsQueryOptions(activeOrganizationId ?? 'no-org'),
    enabled: Boolean(activeOrganizationId) && enabled,
  })
}
