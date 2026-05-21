import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query'

import { calibraApi } from '@/utils/api'
import {
  ensureRouteQueries,
  getStableDashboardOrganizationIdForRouteData,
  prewarmRouteQueries,
} from '@/lib/route-data'
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

function pageFromUrl(url?: URL) {
  const page = Number(url?.searchParams.get('page') ?? 1)
  return Number.isFinite(page) && page > 0 ? page : 1
}

function statusFromUrl(url?: URL): MethodStatus | '' {
  const status = url?.searchParams.get('status') ?? ''

  return METHOD_STATUSES.includes(status as MethodStatus)
    ? (status as MethodStatus)
    : ''
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
    queryFn: () => calibraApi.methods.get(id) as Promise<MethodDetail>,
  })
}

export function methodEditQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['methods', id],
    queryFn: () => calibraApi.methods.get(id) as Promise<MethodEditData>,
  })
}

export function methodAuditLogQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['methods', id, 'audit'],
    queryFn: () =>
      calibraApi.methods.audit<MethodAuditLogRecord>(
        id,
      ) as Promise<MethodAuditLogData>,
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
