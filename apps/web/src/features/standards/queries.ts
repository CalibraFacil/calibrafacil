import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import type { MassCompositionProfileWriteInput } from '@calibra-facil/client-runtime'
import { isRecord } from '@calibra-facil/shared/record'

import { REFERENCE_STANDARD_STATUS } from '@calibra-facil/schemas/machines'
import { calibraApi } from '@/utils/api'
import { keepPreviousDataInScope } from '@calibra-facil/shared/query-scope'
import {
  getStableDashboardOrganizationIdForRouteData,
  routeData,
} from '@/lib/route-data'
import { optionFromUrl, pageFromUrl } from '@/lib/url-search'
import {
  type ImpactedCertificatesData,
  type SendStandardRecallRequest,
  type StandardAuditLogData,
  type StandardAuditLogRecord,
  type StandardDetail,
  type StandardRecallData,
  type StandardsListData,
  type StandardsListQueryInput,
  type StandardStatus,
} from './types'
import { standardKeys } from '@/features/standards/keys'

export const STANDARDS_LIST_LIMIT = 20

function statusFromUrl(url?: URL): StandardStatus | '' {
  return optionFromUrl(
    REFERENCE_STANDARD_STATUS.states,
    url?.searchParams.get('status'),
  )
}

export function standardsListQueryInputFromUrl(
  organizationId: string,
  url?: URL,
) {
  return {
    organizationId,
    page: pageFromUrl(url),
    limit: STANDARDS_LIST_LIMIT,
    search: url?.searchParams.get('query') ?? '',
    statusFilter: statusFromUrl(url),
  } satisfies StandardsListQueryInput
}

export function standardsListQueryOptions(input: StandardsListQueryInput) {
  return queryOptions({
    queryKey: standardKeys.list(input),
    queryFn: (): Promise<StandardsListData> =>
      calibraApi.standards.list({
        query: {
          page: input.page,
          limit: input.limit,
          query: input.search || undefined,
          status: input.statusFilter || undefined,
        },
      }),
    placeholderData: keepPreviousDataInScope(
      standardKeys.listScope(input.organizationId),
    ),
  })
}

export function standardDetailQueryOptions(id: string) {
  return queryOptions({
    queryKey: standardKeys.detail(id),
    queryFn: (): Promise<StandardDetail> =>
      calibraApi.standards.get({ params: { id } }),
  })
}

export function standardAuditLogQueryOptions(id: string) {
  return queryOptions({
    queryKey: standardKeys.auditLog(id),
    queryFn: async (): Promise<StandardAuditLogData> => {
      const log = await calibraApi.standards.auditLog({ params: { id } })
      return {
        data: log.data.map(
          (entry): StandardAuditLogRecord => ({
            ...entry,
            // The column is untyped JSON; the timeline reads it as a record.
            changes: isRecord(entry.changes) ? entry.changes : null,
          }),
        ),
      }
    },
  })
}

// §7.10 recall workflow (#426 Phase 1): current recall campaign (NC link,
// per-certificate notification status) for a reference standard.
export function standardRecallQueryOptions(id: string) {
  return queryOptions({
    queryKey: standardKeys.recall(id),
    queryFn: (): Promise<StandardRecallData> =>
      calibraApi.standards.getRecall({ params: { id } }),
  })
}

// Reverse traceability: approved certificates that relied on this standard in
// a date window. `from`/`to` are ISO strings; when omitted the API defaults to
// the standard's calibrationDate → now (the response echoes the window used).
export function impactedCertificatesQueryOptions(
  id: string,
  from?: string,
  to?: string,
) {
  return queryOptions({
    queryKey: standardKeys.impactedCertificates(id, {
      from: from ?? '',
      to: to ?? '',
    }),
    queryFn: (): Promise<ImpactedCertificatesData> =>
      calibraApi.standards.getImpactedCertificates({
        params: { id },
        query: { from, to },
      }),
  })
}

// The org-shared mass composition profile catalog (normalized buildup weights,
// keyed by class + nominal). Same query key as the execution-flow hook so the
// React Query cache is shared. The API scopes by the session organization.
function compositionProfilesCatalogQueryOptions() {
  return queryOptions({
    queryKey: standardKeys.compositionProfiles,
    queryFn: () => calibraApi.standards.listCompositionProfiles(),
  })
}

export async function loadCompositionProfilesCatalogData(
  queryClient: QueryClient,
) {
  await queryClient.ensureQueryData(compositionProfilesCatalogQueryOptions())
}

async function getStandardsIndexEssentialQueries(url?: URL) {
  const organizationId = await getStableDashboardOrganizationIdForRouteData()
  if (!organizationId) return []

  return [
    standardsListQueryOptions(
      standardsListQueryInputFromUrl(organizationId, url),
    ),
  ]
}

const standardsIndexRouteData = routeData((url?: URL) =>
  getStandardsIndexEssentialQueries(url),
)
export const loadStandardsIndexData = standardsIndexRouteData.load
export const prewarmStandardsIndex = standardsIndexRouteData.prewarm

const standardDetailRouteData = routeData((id: string) => [
  standardDetailQueryOptions(id),
  standardAuditLogQueryOptions(id),
])
export const loadStandardDetailData = standardDetailRouteData.load
export const prewarmStandardDetail = standardDetailRouteData.prewarm

export function useStandardsListData({
  activeOrganizationId,
  enabled,
  page,
  limit,
  search,
  statusFilter,
}: {
  activeOrganizationId: string | null
  enabled: boolean
  page: number
  limit: number
  search: string
  statusFilter: StandardStatus | ''
}) {
  return useQuery({
    ...standardsListQueryOptions({
      organizationId: activeOrganizationId ?? 'no-org',
      page,
      limit,
      search,
      statusFilter,
    }),
    enabled: Boolean(activeOrganizationId) && enabled,
  })
}

export function useStandardDetailData(id: string) {
  return useQuery(standardDetailQueryOptions(id))
}

export function useStandardAuditLogData(id: string) {
  return useQuery(standardAuditLogQueryOptions(id))
}

export function useStandardRecallData(id: string) {
  return useQuery(standardRecallQueryOptions(id))
}

export function useImpactedCertificatesData(
  id: string,
  {
    from,
    to,
    enabled = true,
  }: { from?: string; to?: string; enabled?: boolean },
) {
  return useQuery({
    ...impactedCertificatesQueryOptions(id, from, to),
    enabled,
    placeholderData: (previousData) => previousData,
  })
}

export function useSendStandardRecall(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: SendStandardRecallRequest) =>
      calibraApi.standards.sendRecall({ params: { id }, body: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: standardKeys.recall(id) })
      queryClient.invalidateQueries({
        queryKey: standardKeys.impactedCertificatesOf(id),
      })
    },
  })
}

export function useCompositionProfilesCatalog() {
  return useQuery(compositionProfilesCatalogQueryOptions())
}

export function useCreateCompositionProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: MassCompositionProfileWriteInput) =>
      calibraApi.standards.createCompositionProfile({ body: input }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: standardKeys.compositionProfiles,
      }),
  })
}

export function useUpdateCompositionProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: number
      input: Partial<MassCompositionProfileWriteInput>
    }) =>
      calibraApi.standards.updateCompositionProfile({
        params: { id },
        body: input,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: standardKeys.compositionProfiles,
      }),
  })
}

export function useDeleteCompositionProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      calibraApi.standards.deleteCompositionProfile({ params: { id } }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: standardKeys.compositionProfiles,
      }),
  })
}
