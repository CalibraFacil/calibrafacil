import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query'

import { calibraApi } from '@/utils/api'
import {
  ensureRouteQueries,
  getStableDashboardOrganizationIdForRouteData,
  prewarmRouteQueries,
} from '@/lib/route-data'
import { optionFromUrl, pageFromUrl } from '@/lib/url-search'
import {
  type MethodAuditLogData,
  type MethodAuditLogRecord,
  type MethodDetail,
  type MethodEditData,
  METHOD_STATUSES,
  type MethodsListData,
  type MethodsListQueryInput,
  type MethodStatus,
} from './types'

export const METHODS_LIST_LIMIT = 20

function statusFromUrl(url?: URL): MethodStatus | '' {
  return optionFromUrl(METHOD_STATUSES, url?.searchParams.get('status'))
}

export function methodsListQueryInputFromUrl(
  organizationId: string,
  url?: URL,
) {
  return {
    organizationId,
    page: pageFromUrl(url),
    limit: METHODS_LIST_LIMIT,
    search: url?.searchParams.get('query') ?? '',
    statusFilter: statusFromUrl(url),
  } satisfies MethodsListQueryInput
}

export function methodsListQueryOptions(input: MethodsListQueryInput) {
  return queryOptions({
    queryKey: [
      'methods',
      input.organizationId,
      input.page,
      input.search,
      input.statusFilter,
    ],
    queryFn: () =>
      // oxlint-disable-next-line typescript/consistent-type-assertions -- method list DTOs need schema-backed normalization before this status-narrowing cast can be removed.
      calibraApi.methods.list({
        page: input.page,
        limit: input.limit,
        query: input.search || undefined,
        status: input.statusFilter || undefined,
      }) as Promise<MethodsListData>,
  })
}

export function methodDetailQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['methods', id],
    queryFn: () =>
      // oxlint-disable-next-line typescript/consistent-type-assertions -- method detail DTOs need schema-backed normalization before this view-model cast can be removed.
      calibraApi.methods.get(id) as Promise<MethodDetail>,
  })
}

export function methodEditQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['methods', id],
    queryFn: () =>
      // oxlint-disable-next-line typescript/consistent-type-assertions -- method edit DTOs need schema-backed normalization before this builder-model cast can be removed.
      calibraApi.methods.get(id) as Promise<MethodEditData>,
  })
}

export function methodAuditLogQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['methods', id, 'audit'],
    queryFn: (): Promise<MethodAuditLogData> =>
      calibraApi.methods.audit<MethodAuditLogRecord>(id),
  })
}

export async function getMethodsIndexEssentialQueries(url?: URL) {
  const organizationId = await getStableDashboardOrganizationIdForRouteData()
  if (!organizationId) return []

  return [
    methodsListQueryOptions(methodsListQueryInputFromUrl(organizationId, url)),
  ]
}

export async function loadMethodsIndexData(
  queryClient: QueryClient,
  url?: URL,
) {
  await ensureRouteQueries(
    queryClient,
    await getMethodsIndexEssentialQueries(url),
  )
}

export async function prewarmMethodsIndex(queryClient: QueryClient, url?: URL) {
  await prewarmRouteQueries(
    queryClient,
    await getMethodsIndexEssentialQueries(url),
  )
}

export async function loadMethodDetailData(
  queryClient: QueryClient,
  id: string,
) {
  await ensureRouteQueries(queryClient, [
    methodDetailQueryOptions(id),
    methodAuditLogQueryOptions(id),
  ])
}

export async function prewarmMethodDetail(
  queryClient: QueryClient,
  id: string,
) {
  await prewarmRouteQueries(queryClient, [
    methodDetailQueryOptions(id),
    methodAuditLogQueryOptions(id),
  ])
}

export async function loadMethodEditData(queryClient: QueryClient, id: string) {
  await ensureRouteQueries(queryClient, [methodEditQueryOptions(id)])
}

export async function prewarmMethodEdit(queryClient: QueryClient, id: string) {
  await prewarmRouteQueries(queryClient, [methodEditQueryOptions(id)])
}

export function useMethodsListData({
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
  statusFilter: MethodStatus | ''
}) {
  return useQuery({
    ...methodsListQueryOptions({
      organizationId: activeOrganizationId ?? 'no-org',
      page,
      limit,
      search,
      statusFilter,
    }),
    enabled: Boolean(activeOrganizationId) && enabled,
  })
}

export function useMethodDetailData(id: string) {
  return useQuery(methodDetailQueryOptions(id))
}

export function useMethodEditData(id: string) {
  return useQuery(methodEditQueryOptions(id))
}

export function useMethodAuditLogData(id: string) {
  return useQuery(methodAuditLogQueryOptions(id))
}
