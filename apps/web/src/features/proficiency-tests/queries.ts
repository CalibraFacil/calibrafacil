import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import type {
  CreateProficiencyTestInput,
  CreatePtPlanItemInput,
  RecordPtResultsInput,
} from '@calibra-facil/schemas'
import type {
  ProficiencyTestUpdateInput,
  PtPlanItemUpdateInput,
} from '@calibra-facil/client-runtime'

import { calibraApi } from '@/utils/api'
import {
  ensureRouteQueries,
  getStableDashboardOrganizationIdForRouteData,
  prewarmRouteQueries,
} from '@/lib/route-data'
import { optionFromUrl, pageFromUrl } from '@/lib/url-search'
import {
  PT_ACTIVITY_TYPES,
  PT_STATUSES,
  type PtAuditLogData,
  type PtDetail,
  type PtListData,
  type PtListQueryInput,
  type PtPlanData,
  type PtPlanItem,
  type PtStandardOptionsData,
  type PtSummaryData,
} from './types'

const PT_LIST_LIMIT = 20

export function ptListInputFromUrl(organizationId: string, url?: URL) {
  return {
    organizationId,
    page: pageFromUrl(url),
    search: url?.searchParams.get('query') ?? '',
    statusFilter: optionFromUrl(PT_STATUSES, url?.searchParams.get('status')),
    activityTypeFilter: optionFromUrl(
      PT_ACTIVITY_TYPES,
      url?.searchParams.get('activityType'),
    ),
  } satisfies PtListQueryInput
}

export function ptListQueryOptions(input: PtListQueryInput) {
  return queryOptions({
    queryKey: [
      'proficiency-tests',
      input.organizationId,
      input.page,
      input.search,
      input.statusFilter,
      input.activityTypeFilter,
    ],
    queryFn: () =>
      calibraApi.proficiencyTests.list<PtListData>({
        page: input.page,
        limit: PT_LIST_LIMIT,
        query: input.search || undefined,
        status: input.statusFilter || undefined,
        activityType: input.activityTypeFilter || undefined,
      }),
  })
}

export function ptSummaryQueryOptions(organizationId: string) {
  return queryOptions({
    queryKey: ['proficiency-tests-summary', organizationId],
    queryFn: () => calibraApi.proficiencyTests.summary<PtSummaryData>(),
  })
}

export function ptDetailQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['proficiency-test', id],
    queryFn: () => calibraApi.proficiencyTests.get<PtDetail>(id),
  })
}

export function ptAuditLogQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['proficiency-test-audit-log', id],
    queryFn: () => calibraApi.proficiencyTests.auditLog<PtAuditLogData>(id),
  })
}

export function ptPlanQueryOptions(organizationId: string) {
  return queryOptions({
    queryKey: ['proficiency-tests-plan', organizationId],
    queryFn: () => calibraApi.proficiencyTests.listPlan<PtPlanData>(),
  })
}

export function ptStandardOptionsQueryOptions() {
  return queryOptions({
    queryKey: ['pt-standard-options'],
    queryFn: (): Promise<PtStandardOptionsData> =>
      calibraApi.standards.list({
        page: 1,
        limit: 100,
      }),
  })
}

export async function getPtIndexEssentialQueries(url?: URL) {
  const organizationId = await getStableDashboardOrganizationIdForRouteData()
  if (!organizationId) return []

  return [
    ptListQueryOptions(ptListInputFromUrl(organizationId, url)),
    ptSummaryQueryOptions(organizationId),
  ]
}

export async function loadPtIndexData(queryClient: QueryClient, url?: URL) {
  await ensureRouteQueries(queryClient, await getPtIndexEssentialQueries(url))
}

export async function prewarmPtIndex(queryClient: QueryClient, url?: URL) {
  await prewarmRouteQueries(queryClient, await getPtIndexEssentialQueries(url))
}

export async function prewarmPtDetail(queryClient: QueryClient, id: string) {
  await prewarmRouteQueries(queryClient, [
    ptDetailQueryOptions(id),
    ptAuditLogQueryOptions(id),
  ])
}

export function usePtStandardOptionsData({ enabled }: { enabled: boolean }) {
  return useQuery({
    ...ptStandardOptionsQueryOptions(),
    enabled,
  })
}

export function usePtListData({
  organizationId,
  enabled,
  page,
  search,
  statusFilter,
  activityTypeFilter,
}: PtListQueryInput & {
  enabled: boolean
}) {
  return useQuery({
    ...ptListQueryOptions({
      organizationId,
      page,
      search,
      statusFilter,
      activityTypeFilter,
    }),
    enabled,
  })
}

export function usePtSummaryData({
  organizationId,
  enabled,
}: {
  organizationId: string
  enabled: boolean
}) {
  return useQuery({
    ...ptSummaryQueryOptions(organizationId),
    enabled,
  })
}

export function usePtDetailData({
  id,
  enabled,
}: {
  id: string
  enabled: boolean
}) {
  return useQuery({
    ...ptDetailQueryOptions(id),
    enabled,
  })
}

export function usePtAuditLogData({
  id,
  enabled,
}: {
  id: string
  enabled: boolean
}) {
  return useQuery({
    ...ptAuditLogQueryOptions(id),
    enabled,
  })
}

export function usePtPlanData({
  organizationId,
  enabled,
}: {
  organizationId: string
  enabled: boolean
}) {
  return useQuery({
    ...ptPlanQueryOptions(organizationId),
    enabled,
  })
}

function invalidatePtCollections(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ['proficiency-tests'] })
  queryClient.invalidateQueries({ queryKey: ['proficiency-tests-summary'] })
}

export function useCreatePtRound() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateProficiencyTestInput) =>
      calibraApi.proficiencyTests.create<PtDetail>(input),
    onSuccess: () => {
      invalidatePtCollections(queryClient)
    },
  })
}

export function useUpdatePtRound(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: ProficiencyTestUpdateInput) =>
      calibraApi.proficiencyTests.update<PtDetail>(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proficiency-test', id] })
      queryClient.invalidateQueries({
        queryKey: ['proficiency-test-audit-log', id],
      })
      invalidatePtCollections(queryClient)
    },
  })
}

export function useRecordPtResults(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: RecordPtResultsInput) =>
      calibraApi.proficiencyTests.recordResults<PtDetail>(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proficiency-test', id] })
      queryClient.invalidateQueries({
        queryKey: ['proficiency-test-audit-log', id],
      })
      queryClient.invalidateQueries({ queryKey: ['proficiency-tests-plan'] })
      invalidatePtCollections(queryClient)
    },
  })
}

export function useRemovePtRound() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => calibraApi.proficiencyTests.remove(id),
    onSuccess: () => {
      invalidatePtCollections(queryClient)
    },
  })
}

export function useCreatePtPlanItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreatePtPlanItemInput) =>
      calibraApi.proficiencyTests.createPlanItem<PtPlanItem>(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proficiency-tests-plan'] })
      queryClient.invalidateQueries({
        queryKey: ['proficiency-tests-summary'],
      })
    },
  })
}

export function useUpdatePtPlanItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: PtPlanItemUpdateInput }) =>
      calibraApi.proficiencyTests.updatePlanItem<PtPlanItem>(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proficiency-tests-plan'] })
      queryClient.invalidateQueries({
        queryKey: ['proficiency-tests-summary'],
      })
    },
  })
}

export function useRemovePtPlanItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => calibraApi.proficiencyTests.removePlanItem(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proficiency-tests-plan'] })
      queryClient.invalidateQueries({
        queryKey: ['proficiency-tests-summary'],
      })
    },
  })
}
