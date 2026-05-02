import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query'

import { api } from '@/utils/api'
import {
  ensureRouteQueries,
  getStableDashboardOrganizationIdForRouteData,
  prewarmRouteQueries,
} from '@/lib/route-data'

export type DashboardJobStatus =
  | 'DRAFT'
  | 'IN_PROGRESS'
  | 'REVIEW'
  | 'GENERATING_PDF'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELED'
  | 'SUPERSEDED'

export type DashboardJob = {
  id: number
  jobId: string
  customerName: string | null
  assetName: string | null
  serviceName: string | null
  technicianName: string | null
  status: DashboardJobStatus
  dueDate: string | null
  isOverdue: boolean | null
  createdAt: string
}

export type DashboardStats = {
  pendingCalibrations: number
  approvedThisMonth: number
  rejectedThisMonth: number
  approvalRate: number
  expiringStandards: number
  overdueJobs: number
  dueToday: number
  dueNextSevenDays: number
  statusBreakdown: Array<{ status: DashboardJobStatus; count: number }>
  reviewQueue: DashboardJob[]
  standardsWatchlist: Array<{
    id: number
    name: string
    serialNumber: string
    certificateNumber: string
    nextCalibrationDate: string
    status: string
  }>
  calibrationTrend: Array<{ date: string; approved: number; rejected: number }>
  recentJobs: DashboardJob[]
}

export function dashboardStatsQueryOptions(organizationId: string) {
  return queryOptions({
    queryKey: ['dashboard', 'stats', organizationId],
    queryFn: async () => {
      const res = await api.api.dashboard.stats.$get()
      if (!res.ok) {
        throw new Error('Falha ao carregar estatísticas')
      }

      return res.json() as Promise<DashboardStats>
    },
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
