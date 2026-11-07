import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query'

import { prewarmRouteQueries } from '@/lib/route-data'
import { calibraApi } from '@/utils/api'
import { reportKeys } from './keys'
import type { ReportsQueryInput } from './types'

const DEFAULT_REPORT_PERIOD = '30d'

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
    queryKey: reportKeys.executiveOverview(input),
    queryFn: () =>
      calibraApi.reports.getExecutiveOverview({
        query: { period: input.period, unitIds: input.unitIds },
      }),
  })
}

export function comparisonReportQueryOptions(input: ReportsQueryInput) {
  return queryOptions({
    queryKey: reportKeys.comparison(input),
    queryFn: () =>
      calibraApi.reports.getComparison({
        query: { period: input.period, unitIds: input.unitIds },
      }),
  })
}

export function trendReportQueryOptions(input: ReportsQueryInput) {
  return queryOptions({
    queryKey: reportKeys.trend(input),
    queryFn: () =>
      calibraApi.reports.getTrend({
        query: { period: input.period, unitIds: input.unitIds },
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
