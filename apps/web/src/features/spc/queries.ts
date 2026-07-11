import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import type {
  CreateCheckStandardReadingInput,
  CreateControlChartInput,
  UpdateControlChartInput,
} from '@calibra-facil/schemas'

import { calibraApi } from '@/utils/api'
import {
  ensureRouteQueries,
  getStableDashboardOrganizationIdForRouteData,
  prewarmRouteQueries,
} from '@/lib/route-data'
import { optionFromUrl, pageFromUrl } from '@/lib/url-search'
import {
  SPC_STATUSES,
  type SpcChart,
  type SpcChartDetail,
  type SpcChartListData,
  type SpcChartListQueryInput,
  type SpcEscalateResult,
  type SpcStandardOptionsData,
} from './types'

const SPC_LIST_LIMIT = 50

function standardIdFromUrl(url?: URL): number | undefined {
  const raw = url?.searchParams.get('standardId')
  if (!raw) return undefined
  const parsed = Number(raw)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

export function spcChartListInputFromUrl(organizationId: string, url?: URL) {
  return {
    organizationId,
    page: pageFromUrl(url),
    standardId: standardIdFromUrl(url),
    statusFilter: optionFromUrl(SPC_STATUSES, url?.searchParams.get('status')),
  } satisfies SpcChartListQueryInput
}

export function spcChartListQueryOptions(input: SpcChartListQueryInput) {
  return queryOptions({
    queryKey: [
      'spc-charts',
      input.organizationId,
      input.page,
      input.standardId ?? null,
      input.statusFilter,
    ],
    queryFn: () =>
      calibraApi.spc.listCharts<SpcChartListData>({
        page: input.page,
        limit: SPC_LIST_LIMIT,
        standardId: input.standardId,
        status: input.statusFilter || undefined,
      }),
  })
}

/**
 * Unfiltered first page used for the overview status tiles — the API has no
 * dedicated summary endpoint, so tiles count the (bounded) chart population.
 */
export function spcChartStatusSummaryQueryOptions(organizationId: string) {
  return queryOptions({
    queryKey: ['spc-charts-summary', organizationId],
    queryFn: () =>
      calibraApi.spc.listCharts<SpcChartListData>({
        page: 1,
        limit: 100,
      }),
  })
}

export function spcStandardChartsQueryOptions(standardId: number) {
  return queryOptions({
    queryKey: ['spc-charts', 'by-standard', standardId],
    queryFn: () =>
      calibraApi.spc.listCharts<SpcChartListData>({
        standardId,
        page: 1,
        limit: 50,
      }),
  })
}

export function spcChartDetailQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['spc-chart', id],
    queryFn: () => calibraApi.spc.getChart<SpcChartDetail>(id),
  })
}

export function spcStandardOptionsQueryOptions() {
  return queryOptions({
    queryKey: ['spc-standard-options'],
    queryFn: (): Promise<SpcStandardOptionsData> =>
      calibraApi.standards.list({
        page: 1,
        limit: 100,
      }),
  })
}

export async function getSpcIndexEssentialQueries(url?: URL) {
  const organizationId = await getStableDashboardOrganizationIdForRouteData()
  if (!organizationId) return []

  return [
    spcChartListQueryOptions(spcChartListInputFromUrl(organizationId, url)),
    spcChartStatusSummaryQueryOptions(organizationId),
  ]
}

export async function loadSpcIndexData(queryClient: QueryClient, url?: URL) {
  await ensureRouteQueries(queryClient, await getSpcIndexEssentialQueries(url))
}

export async function prewarmSpcIndex(queryClient: QueryClient, url?: URL) {
  await prewarmRouteQueries(queryClient, await getSpcIndexEssentialQueries(url))
}

export async function prewarmSpcChartDetail(
  queryClient: QueryClient,
  id: string,
) {
  await prewarmRouteQueries(queryClient, [spcChartDetailQueryOptions(id)])
}

export function useSpcChartListData({
  organizationId,
  enabled,
  page,
  standardId,
  statusFilter,
}: SpcChartListQueryInput & {
  enabled: boolean
}) {
  return useQuery({
    ...spcChartListQueryOptions({
      organizationId,
      page,
      standardId,
      statusFilter,
    }),
    enabled,
  })
}

export function useSpcChartStatusSummaryData({
  organizationId,
  enabled,
}: {
  organizationId: string
  enabled: boolean
}) {
  return useQuery({
    ...spcChartStatusSummaryQueryOptions(organizationId),
    enabled,
  })
}

export function useSpcStandardChartsData({
  standardId,
  enabled,
}: {
  standardId: number
  enabled: boolean
}) {
  return useQuery({
    ...spcStandardChartsQueryOptions(standardId),
    enabled,
  })
}

export function useSpcChartDetailData({
  id,
  enabled,
}: {
  id: string
  enabled: boolean
}) {
  return useQuery({
    ...spcChartDetailQueryOptions(id),
    enabled,
  })
}

export function useSpcStandardOptionsData({ enabled }: { enabled: boolean }) {
  return useQuery({
    ...spcStandardOptionsQueryOptions(),
    enabled,
  })
}

function invalidateSpcCollections(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ['spc-charts'] })
  queryClient.invalidateQueries({ queryKey: ['spc-charts-summary'] })
}

export function useCreateSpcChart() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateControlChartInput) =>
      calibraApi.spc.createChart<SpcChart>(input),
    onSuccess: () => {
      invalidateSpcCollections(queryClient)
    },
  })
}

export function useUpdateSpcChart(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateControlChartInput) =>
      calibraApi.spc.updateChart<SpcChart>(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['spc-chart', id] })
      invalidateSpcCollections(queryClient)
    },
  })
}

export function useRemoveSpcChart() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => calibraApi.spc.removeChart(id),
    onSuccess: () => {
      invalidateSpcCollections(queryClient)
    },
  })
}

export function useRecalculateSpcChart(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => calibraApi.spc.recalculateChart<SpcChart>(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['spc-chart', id] })
      invalidateSpcCollections(queryClient)
    },
  })
}

export function useEscalateSpcChart(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { description?: string }) =>
      calibraApi.spc.escalateChart<SpcEscalateResult>(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['spc-chart', id] })
      invalidateSpcCollections(queryClient)
    },
  })
}

export function useCreateSpcReading(chartId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateCheckStandardReadingInput) =>
      calibraApi.spc.createReading(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['spc-chart', chartId] })
      invalidateSpcCollections(queryClient)
    },
  })
}

export function useRemoveSpcReading(chartId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => calibraApi.spc.removeReading(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['spc-chart', chartId] })
      invalidateSpcCollections(queryClient)
    },
  })
}
