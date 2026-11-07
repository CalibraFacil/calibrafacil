import { queryOptions, useQuery } from '@tanstack/react-query'

import { COMPETENCE_STATUS } from '@calibra-facil/schemas/machines'
import { calibraApi } from '@/utils/api'
import { keepPreviousDataInScope } from '@calibra-facil/shared/query-scope'
import {
  getStableDashboardOrganizationIdForRouteData,
  routeData,
} from '@/lib/route-data'
import { type CompetencesListQueryInput, type CompetenceStatus } from './types'
import { competenceKeys, trainingRecordKeys } from '@/features/personnel/keys'

export const COMPETENCES_LIST_LIMIT = 20

function pageFromUrl(url?: URL) {
  const page = Number(url?.searchParams.get('page') ?? 1)
  return Number.isFinite(page) && page > 0 ? page : 1
}

function statusFromUrl(url?: URL): CompetenceStatus | '' {
  return COMPETENCE_STATUS.parse(url?.searchParams.get('status')) ?? ''
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
    queryKey: competenceKeys.list(input),
    queryFn: () =>
      calibraApi.competences.list({
        query: {
          page: input.page,
          limit: input.limit,
          status: input.statusFilter || undefined,
        },
      }),
    placeholderData: keepPreviousDataInScope(
      competenceKeys.listScope(input.organizationId),
    ),
  })
}

export function competencesMatrixQueryOptions(organizationId: string) {
  return queryOptions({
    queryKey: competenceKeys.matrix(organizationId),
    queryFn: () => calibraApi.competences.matrix(),
  })
}

export function newCompetenceMatrixQueryOptions() {
  return queryOptions({
    queryKey: competenceKeys.matrices,
    queryFn: () => calibraApi.competences.matrix(),
  })
}

export function competenceDetailQueryOptions(id: string) {
  return queryOptions({
    queryKey: competenceKeys.detail(id),
    queryFn: () => calibraApi.competences.get({ params: { id } }),
  })
}

export function competenceAuditLogQueryOptions(id: string) {
  return queryOptions({
    queryKey: competenceKeys.audit(id),
    queryFn: () => calibraApi.competences.auditLog({ params: { id } }),
  })
}

export function assignableTrainingRecordsQueryOptions(userId: string) {
  return queryOptions({
    queryKey: trainingRecordKeys.assignable(userId),
    queryFn: () =>
      calibraApi.trainingRecords.list({
        query: { page: 1, limit: 100, userId },
      }),
  })
}

async function getPersonnelIndexEssentialQueries(url?: URL) {
  const organizationId = await getStableDashboardOrganizationIdForRouteData()
  if (!organizationId) return []

  return [
    competencesListQueryOptions(
      competencesListQueryInputFromUrl(organizationId, url),
    ),
  ]
}

const personnelIndexRouteData = routeData((url?: URL) =>
  getPersonnelIndexEssentialQueries(url),
)
export const loadPersonnelIndexData = personnelIndexRouteData.load
export const prewarmPersonnelIndex = personnelIndexRouteData.prewarm

const competenceDetailRouteData = routeData((id: string) => [
  competenceDetailQueryOptions(id),
])
export const loadCompetenceDetailData = competenceDetailRouteData.load
export const prewarmCompetenceDetail = competenceDetailRouteData.prewarm

const competenceAuditRouteData = routeData((id: string) => [
  competenceDetailQueryOptions(id),
  competenceAuditLogQueryOptions(id),
])
export const loadCompetenceAuditData = competenceAuditRouteData.load
export const prewarmCompetenceAudit = competenceAuditRouteData.prewarm

const newCompetenceRouteData = routeData(() => [
  newCompetenceMatrixQueryOptions(),
])
export const loadNewCompetenceData = newCompetenceRouteData.load
export const prewarmNewCompetence = newCompetenceRouteData.prewarm

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
