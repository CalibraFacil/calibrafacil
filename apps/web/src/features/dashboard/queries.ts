import { queryOptions, useQuery } from '@tanstack/react-query'
import type {
  DashboardJob,
  DashboardJobStatus,
  DashboardStats,
} from '@calibra-facil/client-runtime'

import {
  getStableDashboardOrganizationIdForRouteData,
  routeData,
} from '@/lib/route-data'
import { calibraApi } from '@/utils/api'
import { dashboardKeys } from '@/features/dashboard/keys'

export type { DashboardJob, DashboardJobStatus, DashboardStats }

export function dashboardStatsQueryOptions(organizationId: string) {
  return queryOptions({
    queryKey: dashboardKeys.stats(organizationId),
    queryFn: () => calibraApi.dashboard.getStats(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
}

async function getDashboardIndexEssentialQueries() {
  const organizationId = await getStableDashboardOrganizationIdForRouteData()
  if (!organizationId) return []

  return [dashboardStatsQueryOptions(organizationId)]
}

const dashboardIndexRouteData = routeData(() =>
  getDashboardIndexEssentialQueries(),
)
export const loadDashboardIndexData = dashboardIndexRouteData.load
export const prewarmDashboardIndex = dashboardIndexRouteData.prewarm

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
