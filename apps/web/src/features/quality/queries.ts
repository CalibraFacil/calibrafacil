import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query'
import type {
  OotImpactAssessmentData,
  OotNotificationData,
} from '@calibra-facil/client-runtime'

import { calibraApi } from '@/utils/api'
import {
  ensureRouteQueries,
  getStableDashboardOrganizationIdForRouteData,
  prewarmRouteQueries,
} from '@/lib/route-data'
import { optionFromUrl, pageFromUrl } from '@/lib/url-search'
import {
  CAPA_CATEGORIES,
  CAPA_SEVERITIES,
  CAPA_STATUSES,
  NON_CONFORMANCE_STATUSES,
  NON_CONFORMANCE_TYPES,
  type CapaAuditLogData,
  type CapaDetail,
  type CapaListData,
  type CapaListQueryInput,
  type CapaResponsibleMembersData,
  type CapaSummaryData,
  type NewNonConformanceJobsData,
  type NonConformanceAuditLogData,
  type NonConformanceDetail,
  type NonConformanceListData,
  type NonConformanceListQueryInput,
  type NonConformanceSummaryData,
} from './types'

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
      NON_CONFORMANCE_STATUSES,
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
    statusFilter: optionFromUrl(CAPA_STATUSES, url?.searchParams.get('status')),
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
    queryKey: [
      'non-conformances',
      input.organizationId,
      input.page,
      input.search,
      input.statusFilter,
      input.typeFilter,
    ],
    queryFn: () =>
      calibraApi.nonConformances.list<NonConformanceListData>({
        page: input.page,
        limit: QUALITY_LIST_LIMIT,
        query: input.search || undefined,
        status: input.statusFilter || undefined,
        type: input.typeFilter || undefined,
      }),
  })
}

export function nonConformanceSummaryQueryOptions(organizationId: string) {
  return queryOptions({
    queryKey: ['non-conformances-summary', organizationId],
    queryFn: () =>
      calibraApi.nonConformances.summary<NonConformanceSummaryData>(),
  })
}

export function nonConformanceDetailQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['non-conformance', id],
    queryFn: () => calibraApi.nonConformances.get<NonConformanceDetail>(id),
  })
}

export function nonConformanceAuditLogQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['non-conformance-audit', id],
    queryFn: () =>
      calibraApi.nonConformances.auditLog<NonConformanceAuditLogData>(id),
  })
}

export function ootNotificationQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['non-conformance-oot-notification', id],
    queryFn: () =>
      calibraApi.nonConformances.getOotNotification<{
        data: OotNotificationData | null
      }>(id),
  })
}

export function ootImpactAssessmentQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['non-conformance-impact-assessment', id],
    queryFn: () =>
      calibraApi.nonConformances.getImpactAssessment<{
        data: OotImpactAssessmentData | null
      }>(id),
  })
}

export function nonConformanceJobsQueryOptions() {
  return queryOptions({
    queryKey: ['jobs-for-nc'],
    queryFn: (): Promise<NewNonConformanceJobsData> =>
      calibraApi.jobs.list({
        page: 1,
        limit: 100,
      }),
  })
}

export function capaListQueryOptions(input: CapaListQueryInput) {
  return queryOptions({
    queryKey: [
      'capas',
      input.organizationId,
      input.page,
      input.search,
      input.statusFilter,
      input.severityFilter,
      input.categoryFilter,
    ],
    queryFn: () =>
      calibraApi.capas.list<CapaListData>({
        page: input.page,
        limit: QUALITY_LIST_LIMIT,
        query: input.search || undefined,
        status: input.statusFilter || undefined,
        severity: input.severityFilter || undefined,
        category: input.categoryFilter || undefined,
      }),
  })
}

export function capaSummaryQueryOptions(organizationId: string) {
  return queryOptions({
    queryKey: ['capas-summary', organizationId],
    queryFn: () => calibraApi.capas.summary<CapaSummaryData>(),
  })
}

export function capaDetailQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['capa', id],
    queryFn: () => calibraApi.capas.get<CapaDetail>(id),
  })
}

export function capaAuditLogQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['capa-audit-log', id],
    queryFn: () => calibraApi.capas.auditLog<CapaAuditLogData>(id),
  })
}

export function capaResponsibleMembersQueryOptions() {
  return queryOptions({
    queryKey: ['jobs', 'technicians'],
    queryFn: (): Promise<CapaResponsibleMembersData> =>
      calibraApi.jobs.listTechnicians(),
  })
}

export async function getNonConformancesIndexEssentialQueries(url?: URL) {
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

export async function getCapasIndexEssentialQueries(url?: URL) {
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

export function useNonConformanceJobsData({ enabled }: { enabled: boolean }) {
  return useQuery({
    ...nonConformanceJobsQueryOptions(),
    enabled,
  })
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
