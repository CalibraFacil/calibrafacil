import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query'

import { prewarmRouteQueries } from '@/lib/route-data'
import { calibraApi } from '@/utils/api'
import type {
  ComparisonResponse,
  ExecutiveOverviewResponse,
  ReportsQueryInput,
  TrendResponse,
} from './types'

const DEFAULT_REPORT_PERIOD = '30d'

function organizationKey(organizationId: string | null | undefined) {
  return organizationId ?? 'no-org'
}

function unitIdsKey(unitIds: string | undefined) {
  return unitIds ?? 'all'
}

export function defaultReportsQueryInput(
  organizationId: string | null | undefined,
) {
  return {
    organizationId,
    period: DEFAULT_REPORT_PERIOD,
    unitIds: undefined,
  } satisfies ReportsQueryInput
}

export function executiveReportQueryOptions(input: ReportsQueryInput) {
  return queryOptions({
    queryKey: [
      'reports',
      'executive-overview',
      organizationKey(input.organizationId),
      input.period,
      unitIdsKey(input.unitIds),
    ],
    queryFn: () =>
      calibraApi.reports.getExecutiveOverview<ExecutiveOverviewResponse>({
        period: input.period,
        unitIds: input.unitIds,
      }),
  })
}

export function comparisonReportQueryOptions(input: ReportsQueryInput) {
  return queryOptions({
    queryKey: [
      'reports',
      'comparison',
      organizationKey(input.organizationId),
      input.period,
      unitIdsKey(input.unitIds),
    ],
    queryFn: () =>
      calibraApi.reports.getComparison<ComparisonResponse>({
        period: input.period,
        unitIds: input.unitIds,
      }),
  })
}

export function trendReportQueryOptions(input: ReportsQueryInput) {
  return queryOptions({
    queryKey: [
      'reports',
      'trend',
      organizationKey(input.organizationId),
      input.period,
      unitIdsKey(input.unitIds),
    ],
    queryFn: () =>
      calibraApi.reports.getTrend<TrendResponse>({
        period: input.period,
        unitIds: input.unitIds,
      }),
  })
}

export async function prewarmReportsIndex(
  queryClient: QueryClient,
  organizationId: string | null | undefined,
) {
  const input = defaultReportsQueryInput(organizationId)

  await prewarmRouteQueries(queryClient, [
    executiveReportQueryOptions(input),
    comparisonReportQueryOptions(input),
    trendReportQueryOptions(input),
  ])
}

export function useExecutiveReportData({
  enabled,
  input,
}: {
  enabled: boolean
  input: ReportsQueryInput
}) {
  return useQuery({
    ...executiveReportQueryOptions(input),
    enabled,
  })
}

export function useComparisonReportData({
  enabled,
  input,
}: {
  enabled: boolean
  input: ReportsQueryInput
}) {
  return useQuery({
    ...comparisonReportQueryOptions(input),
    enabled,
  })
}

export function useTrendReportData({
  enabled,
  input,
}: {
  enabled: boolean
  input: ReportsQueryInput
}) {
  return useQuery({
    ...trendReportQueryOptions(input),
    enabled,
  })
}
