import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query'

import { calibraApi } from '@/utils/api'
import {
  ensureRouteQueries,
  getStableDashboardOrganizationIdForRouteData,
  prewarmRouteQueries,
} from '@/lib/route-data'
import { optionFromUrl, pageFromUrl } from '@/lib/url-search'
import {
  STANDARD_STATUSES,
  type StandardAuditLogData,
  type StandardAuditLogRecord,
  type StandardDetail,
  type StandardsListData,
  type StandardsListQueryInput,
  type StandardStatus,
} from './types'

export const STANDARDS_LIST_LIMIT = 20

function statusFromUrl(url?: URL): StandardStatus | '' {
  return optionFromUrl(STANDARD_STATUSES, url?.searchParams.get('status'))
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
    queryKey: [
      'standards',
      input.organizationId,
      input.page,
      input.search,
      input.statusFilter,
    ],
    queryFn: (): Promise<StandardsListData> =>
      calibraApi.standards.list({
        page: input.page,
        limit: input.limit,
        query: input.search || undefined,
        status: input.statusFilter || undefined,
      }),
  })
}

export function standardDetailQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['standards', id],
    queryFn: (): Promise<StandardDetail> => calibraApi.standards.get(id),
  })
}

export function standardAuditLogQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['standards', id, 'audit-log'],
    queryFn: (): Promise<StandardAuditLogData> =>
      calibraApi.standards.auditLog<StandardAuditLogRecord>(id),
  })
}

export async function getStandardsIndexEssentialQueries(url?: URL) {
  const organizationId = await getStableDashboardOrganizationIdForRouteData()
  if (!organizationId) return []

  return [
    standardsListQueryOptions(
      standardsListQueryInputFromUrl(organizationId, url),
    ),
  ]
}

export async function loadStandardsIndexData(
  queryClient: QueryClient,
  url?: URL,
) {
  await ensureRouteQueries(
    queryClient,
    await getStandardsIndexEssentialQueries(url),
  )
}

export async function prewarmStandardsIndex(
  queryClient: QueryClient,
  url?: URL,
) {
  await prewarmRouteQueries(
    queryClient,
    await getStandardsIndexEssentialQueries(url),
  )
}

export async function loadStandardDetailData(
  queryClient: QueryClient,
  id: string,
) {
  await ensureRouteQueries(queryClient, [
    standardDetailQueryOptions(id),
    standardAuditLogQueryOptions(id),
  ])
}

export async function prewarmStandardDetail(
  queryClient: QueryClient,
  id: string,
) {
  await prewarmRouteQueries(queryClient, [
    standardDetailQueryOptions(id),
    standardAuditLogQueryOptions(id),
  ])
}

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
