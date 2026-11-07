import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query'
import { calibraApi } from '@/utils/api'
import { keepPreviousDataInScope } from '@calibra-facil/shared/query-scope'
import {
  ensureRouteQueries,
  getStableDashboardOrganizationIdForRouteData,
  prewarmRouteQueries,
} from '@/lib/route-data'
import { optionFromUrl, pageFromUrl } from '@/lib/url-search'
import {
  CORRECTIVE_ACTION_STATUS,
  NON_CONFORMANCE_STATUS,
} from '@calibra-facil/schemas/machines'
import {
  CAPA_CATEGORIES,
  CAPA_SEVERITIES,
  NON_CONFORMANCE_TYPES,
  type CapaListQueryInput,
  type CapaResponsibleMembersData,
  type NewNonConformanceJobsData,
  type NonConformanceListQueryInput,
} from './types'
import { capaKeys, nonConformanceKeys } from '@/features/quality/keys'
import { jobKeys } from '@/features/jobs/keys'

const QUALITY_LIST_LIMIT = 20

export function nonConformanceListInputFromUrl(
  organizationId: string,
  url?: URL,
) {
  return {
    organizationId,
    page: pageFromUrl(url),
    search: url?.searchParams.get('query') ?? '',
    statusFilter: optionFromUrl(
      NON_CONFORMANCE_STATUS.states,
      url?.searchParams.get('status'),
    ),
    typeFilter: optionFromUrl(
      NON_CONFORMANCE_TYPES,
      url?.searchParams.get('type'),
    ),
  } satisfies NonConformanceListQueryInput
}

export function capaListInputFromUrl(organizationId: string, url?: URL) {
  return {
    organizationId,
    page: pageFromUrl(url),
    search: url?.searchParams.get('query') ?? '',
    statusFilter: optionFromUrl(
      CORRECTIVE_ACTION_STATUS.states,
      url?.searchParams.get('status'),
    ),
    severityFilter: optionFromUrl(
      CAPA_SEVERITIES,
      url?.searchParams.get('severity'),
    ),
    categoryFilter: optionFromUrl(
      CAPA_CATEGORIES,
      url?.searchParams.get('category'),
    ),
  } satisfies CapaListQueryInput
}

export function nonConformanceListQueryOptions(
  input: NonConformanceListQueryInput,
) {
  return queryOptions({
    queryKey: nonConformanceKeys.list(input),
    queryFn: () =>
      calibraApi.nonConformances.list({
        query: {
          page: input.page,
          limit: QUALITY_LIST_LIMIT,
          query: input.search || undefined,
          status: input.statusFilter || undefined,
          type: input.typeFilter || undefined,
        },
      }),
    placeholderData: keepPreviousDataInScope(
      nonConformanceKeys.listScope(input.organizationId),
    ),
  })
}

function nonConformanceSummaryQueryOptions(organizationId: string) {
  return queryOptions({
    queryKey: nonConformanceKeys.summary(organizationId),
    queryFn: () => calibraApi.nonConformances.summary(),
  })
}

export function nonConformanceDetailQueryOptions(id: string) {
  return queryOptions({
    queryKey: nonConformanceKeys.detail(id),
    queryFn: () => calibraApi.nonConformances.get({ params: { id } }),
  })
}

export function nonConformanceAuditLogQueryOptions(id: string) {
  return queryOptions({
    queryKey: nonConformanceKeys.audit(id),
    queryFn: () => calibraApi.nonConformances.auditLog({ params: { id } }),
  })
}

function ootNotificationQueryOptions(id: string) {
  return queryOptions({
    queryKey: nonConformanceKeys.ootNotification(id),
    queryFn: () =>
      calibraApi.nonConformances.getOotNotification({ params: { id } }),
  })
}

function ootImpactAssessmentQueryOptions(id: string) {
  return queryOptions({
    queryKey: nonConformanceKeys.impactAssessment(id),
    queryFn: () =>
      calibraApi.nonConformances.getImpactAssessment({ params: { id } }),
  })
}

export function nonConformanceJobsQueryOptions() {
  return queryOptions({
    queryKey: jobKeys.forNonConformance,
    queryFn: (): Promise<NewNonConformanceJobsData> =>
      calibraApi.jobs.list({
        query: {
          page: 1,
          limit: 100,
        },
      }),
  })
}

export function capaListQueryOptions(input: CapaListQueryInput) {
  return queryOptions({
    queryKey: capaKeys.list(input),
    queryFn: () =>
      calibraApi.capas.list({
        query: {
          page: input.page,
          limit: QUALITY_LIST_LIMIT,
          query: input.search || undefined,
          status: input.statusFilter || undefined,
          severity: input.severityFilter || undefined,
          category: input.categoryFilter || undefined,
        },
      }),
    placeholderData: keepPreviousDataInScope(
      capaKeys.listScope(input.organizationId),
    ),
  })
}

function capaSummaryQueryOptions(organizationId: string) {
  return queryOptions({
    queryKey: capaKeys.summary(organizationId),
    queryFn: () => calibraApi.capas.summary(),
  })
}

export function capaDetailQueryOptions(id: string) {
  return queryOptions({
    queryKey: capaKeys.detail(id),
    queryFn: () => calibraApi.capas.get({ params: { id } }),
  })
}

export function capaAuditLogQueryOptions(id: string) {
  return queryOptions({
    queryKey: capaKeys.auditLog(id),
    queryFn: () => calibraApi.capas.auditLog({ params: { id } }),
  })
}

export function capaResponsibleMembersQueryOptions() {
  return queryOptions({
    queryKey: jobKeys.technicians,
    queryFn: (): Promise<CapaResponsibleMembersData> =>
      calibraApi.jobs.listTechnicians(),
  })
}

async function getNonConformancesIndexEssentialQueries(url?: URL) {
  const organizationId = await getStableDashboardOrganizationIdForRouteData()
  if (!organizationId) return []

  return [
    nonConformanceListQueryOptions(
      nonConformanceListInputFromUrl(organizationId, url),
    ),
    nonConformanceSummaryQueryOptions(organizationId),
  ]
}

export async function loadNonConformancesIndexData(
  queryClient: QueryClient,
  url?: URL,
) {
  await ensureRouteQueries(
    queryClient,
    await getNonConformancesIndexEssentialQueries(url),
  )
}

export async function prewarmNonConformancesIndex(
  queryClient: QueryClient,
  url?: URL,
) {
  await prewarmRouteQueries(
    queryClient,
    await getNonConformancesIndexEssentialQueries(url),
  )
}

export async function prewarmNewNonConformance(queryClient: QueryClient) {
  await prewarmRouteQueries(queryClient, [nonConformanceJobsQueryOptions()])
}

export async function prewarmNonConformanceDetail(
  queryClient: QueryClient,
  id: string,
) {
  await prewarmRouteQueries(queryClient, [
    nonConformanceDetailQueryOptions(id),
    nonConformanceAuditLogQueryOptions(id),
  ])
}

async function getCapasIndexEssentialQueries(url?: URL) {
  const organizationId = await getStableDashboardOrganizationIdForRouteData()
  if (!organizationId) return []

  return [
    capaListQueryOptions(capaListInputFromUrl(organizationId, url)),
    capaSummaryQueryOptions(organizationId),
  ]
}

export async function loadCapasIndexData(queryClient: QueryClient, url?: URL) {
  await ensureRouteQueries(
    queryClient,
    await getCapasIndexEssentialQueries(url),
  )
}

export async function prewarmCapasIndex(queryClient: QueryClient, url?: URL) {
  await prewarmRouteQueries(
    queryClient,
    await getCapasIndexEssentialQueries(url),
  )
}

export async function prewarmNewCapa(queryClient: QueryClient) {
  await prewarmRouteQueries(queryClient, [capaResponsibleMembersQueryOptions()])
}

export async function prewarmCapaDetail(queryClient: QueryClient, id: string) {
  await prewarmRouteQueries(queryClient, [
    capaDetailQueryOptions(id),
    capaAuditLogQueryOptions(id),
  ])
}

export function useNonConformanceListData({
  organizationId,
  enabled,
  page,
  search,
  statusFilter,
  typeFilter,
}: NonConformanceListQueryInput & {
  enabled: boolean
}) {
  return useQuery({
    ...nonConformanceListQueryOptions({
      organizationId,
      page,
      search,
      statusFilter,
      typeFilter,
    }),
    enabled,
  })
}

export function useNonConformanceSummaryData({
  organizationId,
  enabled,
}: {
  organizationId: string
  enabled: boolean
}) {
  return useQuery({
    ...nonConformanceSummaryQueryOptions(organizationId),
    enabled,
  })
}

export function useNonConformanceDetailData({
  id,
  enabled,
}: {
  id: string
  enabled: boolean
}) {
  return useQuery({
    ...nonConformanceDetailQueryOptions(id),
    enabled,
  })
}

export function useNonConformanceAuditLogData({
  id,
  enabled,
}: {
  id: string
  enabled: boolean
}) {
  return useQuery({
    ...nonConformanceAuditLogQueryOptions(id),
    enabled,
  })
}

export function useNonConformanceOotNotificationData({
  id,
  enabled,
}: {
  id: string
  enabled: boolean
}) {
  return useQuery({
    ...ootNotificationQueryOptions(id),
    enabled,
  })
}

export function useNonConformanceImpactAssessmentData({
  id,
  enabled,
}: {
  id: string
  enabled: boolean
}) {
  return useQuery({
    ...ootImpactAssessmentQueryOptions(id),
    enabled,
  })
}

export function useNonConformanceJobsData() {
  return useQuery(nonConformanceJobsQueryOptions())
}

export function useCapaListData({
  organizationId,
  enabled,
  page,
  search,
  statusFilter,
  severityFilter,
  categoryFilter,
}: CapaListQueryInput & {
  enabled: boolean
}) {
  return useQuery({
    ...capaListQueryOptions({
      organizationId,
      page,
      search,
      statusFilter,
      severityFilter,
      categoryFilter,
    }),
    enabled,
  })
}

export function useCapaSummaryData({
  organizationId,
  enabled,
}: {
  organizationId: string
  enabled: boolean
}) {
  return useQuery({
    ...capaSummaryQueryOptions(organizationId),
    enabled,
  })
}

export function useCapaDetailData({
  id,
  enabled,
}: {
  id: string
  enabled: boolean
}) {
  return useQuery({
    ...capaDetailQueryOptions(id),
    enabled,
  })
}

export function useCapaAuditLogData({
  id,
  enabled,
}: {
  id: string
  enabled: boolean
}) {
  return useQuery({
    ...capaAuditLogQueryOptions(id),
    enabled,
  })
}

export function useCapaResponsibleMembersData({
  enabled,
}: {
  enabled: boolean
}) {
  return useQuery({
    ...capaResponsibleMembersQueryOptions(),
    enabled,
  })
}
