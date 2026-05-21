import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query'

import { calibraApi } from '@/utils/api'
import {
  ensureRouteQueries,
  getStableDashboardOrganizationIdForRouteData,
  prewarmRouteQueries,
} from '@/lib/route-data'
import {
  type AssignableTrainingRecordsData,
  COMPETENCE_STATUSES,
  type CompetenceAuditLogData,
  type CompetenceDetail,
  type CompetencesListData,
  type CompetencesListQueryInput,
  type CompetencesMatrixData,
  type CompetenceStatus,
} from './types'

export const COMPETENCES_LIST_LIMIT = 20

function pageFromUrl(url?: URL) {
  const page = Number(url?.searchParams.get('page') ?? 1)
  return Number.isFinite(page) && page > 0 ? page : 1
}

function statusFromUrl(url?: URL): CompetenceStatus | '' {
  const status = url?.searchParams.get('status') ?? ''

  return COMPETENCE_STATUSES.includes(status as CompetenceStatus)
    ? (status as CompetenceStatus)
    : ''
}

export function competencesListQueryInputFromUrl(
  organizationId: string,
  url?: URL,
) {
  return {
    organizationId,
    page: pageFromUrl(url),
    limit: COMPETENCES_LIST_LIMIT,
    statusFilter: statusFromUrl(url),
  } satisfies CompetencesListQueryInput
}

export function competencesListQueryOptions(input: CompetencesListQueryInput) {
  return queryOptions({
    queryKey: [
      'competences',
      input.organizationId,
      input.page,
      input.statusFilter,
    ],
    queryFn: () =>
      calibraApi.competences.list<CompetencesListData>({
        page: input.page,
        limit: input.limit,
        status: input.statusFilter || undefined,
      }),
  })
}

export function competencesMatrixQueryOptions(organizationId: string) {
  return queryOptions({
    queryKey: ['competences-matrix', organizationId],
    queryFn: () => calibraApi.competences.matrix<CompetencesMatrixData>(),
  })
}

export function newCompetenceMatrixQueryOptions() {
  return queryOptions({
    queryKey: ['competences-matrix'],
    queryFn: () => calibraApi.competences.matrix<CompetencesMatrixData>(),
  })
}

export function competenceDetailQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['competence', id],
    queryFn: () => calibraApi.competences.get<CompetenceDetail>(id),
  })
}

export function competenceAuditLogQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['competence-audit', id],
    queryFn: () => calibraApi.competences.auditLog<CompetenceAuditLogData>(id),
  })
}

export function assignableTrainingRecordsQueryOptions(userId: string) {
  return queryOptions({
    queryKey: ['training-records', 'assignable', userId],
    queryFn: () =>
      calibraApi.trainingRecords.list<AssignableTrainingRecordsData>({
        page: 1,
        limit: 100,
        userId,
      }),
  })
}

export async function getPersonnelIndexEssentialQueries(url?: URL) {
  const organizationId = await getStableDashboardOrganizationIdForRouteData()
  if (!organizationId) return []

  return [
    competencesListQueryOptions(
      competencesListQueryInputFromUrl(organizationId, url),
    ),
  ]
}

export async function loadPersonnelIndexData(
  queryClient: QueryClient,
  url?: URL,
) {
  await ensureRouteQueries(
    queryClient,
    await getPersonnelIndexEssentialQueries(url),
  )
}

export async function prewarmPersonnelIndex(
  queryClient: QueryClient,
  url?: URL,
) {
  await prewarmRouteQueries(
    queryClient,
    await getPersonnelIndexEssentialQueries(url),
  )
}

export async function loadCompetenceDetailData(
  queryClient: QueryClient,
  id: string,
) {
  await ensureRouteQueries(queryClient, [competenceDetailQueryOptions(id)])
}

export async function prewarmCompetenceDetail(
  queryClient: QueryClient,
  id: string,
) {
  await prewarmRouteQueries(queryClient, [competenceDetailQueryOptions(id)])
}

export async function loadCompetenceAuditData(
  queryClient: QueryClient,
  id: string,
) {
  await ensureRouteQueries(queryClient, [
    competenceDetailQueryOptions(id),
    competenceAuditLogQueryOptions(id),
  ])
}

export async function prewarmCompetenceAudit(
  queryClient: QueryClient,
  id: string,
) {
  await prewarmRouteQueries(queryClient, [
    competenceDetailQueryOptions(id),
    competenceAuditLogQueryOptions(id),
  ])
}

export async function loadNewCompetenceData(queryClient: QueryClient) {
  await ensureRouteQueries(queryClient, [newCompetenceMatrixQueryOptions()])
}

export async function prewarmNewCompetence(queryClient: QueryClient) {
  await prewarmRouteQueries(queryClient, [newCompetenceMatrixQueryOptions()])
}

export function useCompetencesListData({
  activeOrganizationId,
  enabled,
  page,
  limit,
  statusFilter,
}: {
  activeOrganizationId: string | null
  enabled: boolean
  page: number
  limit: number
  statusFilter: CompetenceStatus | ''
}) {
  return useQuery({
    ...competencesListQueryOptions({
      organizationId: activeOrganizationId ?? 'no-org',
      page,
      limit,
      statusFilter,
    }),
    enabled: Boolean(activeOrganizationId) && enabled,
  })
}

export function useCompetencesMatrixData({
  activeOrganizationId,
  enabled,
}: {
  activeOrganizationId: string | null
  enabled: boolean
}) {
  return useQuery({
    ...competencesMatrixQueryOptions(activeOrganizationId ?? 'no-org'),
    enabled: Boolean(activeOrganizationId) && enabled,
  })
}

export function useNewCompetenceMatrixData() {
  return useQuery(newCompetenceMatrixQueryOptions())
}

export function useCompetenceDetailData(id: string) {
  return useQuery(competenceDetailQueryOptions(id))
}

export function useCompetenceAuditLogData(id: string) {
  return useQuery(competenceAuditLogQueryOptions(id))
}

export function useAssignableTrainingRecordsData({
  userId,
  enabled,
}: {
  userId: string
  enabled: boolean
}) {
  return useQuery({
    ...assignableTrainingRecordsQueryOptions(userId),
    enabled,
  })
}
