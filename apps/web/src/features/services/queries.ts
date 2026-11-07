import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query'

import { calibraApi } from '@/utils/api'
import { keepPreviousDataInScope } from '@calibra-facil/shared/query-scope'
import { isRecord } from '@calibra-facil/shared/record'
import {
  ensureRouteQueries,
  getStableDashboardOrganizationIdForRouteData,
  prewarmRouteQueries,
} from '@/lib/route-data'
import { optionFromUrl, pageFromUrl } from '@/lib/url-search'
import {
  type PublishedMethodsData,
  type ServiceAssetTypesData,
  type ServiceAuditLogData,
  type ServiceAuditLogRecord,
  type ServiceDetail,
  SERVICES_LIST_STATUSES,
  type ServicesListData,
  type ServicesListQueryInput,
  type ServicesListStatus,
} from './types'
import { serviceKeys } from '@/features/services/keys'
import { methodKeys } from '@/features/methods/keys'
import { assetKeys } from '@/features/assets/keys'

export const SERVICES_LIST_LIMIT = 20

function statusFromUrl(url?: URL): ServicesListStatus | '' {
  return optionFromUrl(SERVICES_LIST_STATUSES, url?.searchParams.get('status'))
}

export function servicesListQueryInputFromUrl(
  organizationId: string,
  url?: URL,
) {
  return {
    organizationId,
    page: pageFromUrl(url),
    limit: SERVICES_LIST_LIMIT,
    search: url?.searchParams.get('query') ?? '',
    statusFilter: statusFromUrl(url),
  } satisfies ServicesListQueryInput
}

export function servicesListQueryOptions(input: ServicesListQueryInput) {
  return queryOptions({
    queryKey: serviceKeys.list(input),
    queryFn: (): Promise<ServicesListData> =>
      calibraApi.services.list({
        query: {
          page: input.page,
          limit: input.limit,
          query: input.search || undefined,
          isActive:
            input.statusFilter === 'active'
              ? true
              : input.statusFilter === 'inactive'
                ? false
                : undefined,
        },
      }),
    placeholderData: keepPreviousDataInScope(
      serviceKeys.listScope(input.organizationId),
    ),
  })
}

export function serviceDetailQueryOptions(id: string) {
  return queryOptions({
    queryKey: serviceKeys.detail(id),
    queryFn: (): Promise<ServiceDetail> =>
      calibraApi.services.get({ params: { id } }),
  })
}

export function serviceAuditLogQueryOptions(id: string) {
  return queryOptions({
    queryKey: serviceKeys.auditLog(id),
    queryFn: async (): Promise<ServiceAuditLogData> => {
      const log = await calibraApi.services.auditLog({ params: { id } })
      return {
        data: log.data.map(
          (entry): ServiceAuditLogRecord => ({
            ...entry,
            // The column is untyped JSON; the timeline reads it as a record.
            changes: isRecord(entry.changes) ? entry.changes : null,
          }),
        ),
      }
    },
  })
}

export function publishedMethodsQueryOptions() {
  return queryOptions({
    queryKey: methodKeys.published,
    queryFn: (): Promise<PublishedMethodsData> =>
      calibraApi.methods.list({
        query: { status: 'PUBLISHED', limit: 100 },
      }),
  })
}

export function serviceAssetTypesQueryOptions() {
  return queryOptions({
    queryKey: assetKeys.types,
    queryFn: async (): Promise<ServiceAssetTypesData> => {
      const result = await calibraApi.assetTypes.list()
      return {
        data: result.data.map((assetType) => ({
          id: assetType.id,
          name: assetType.name,
          slug: assetType.slug ?? String(assetType.id),
        })),
      }
    },
  })
}

async function getServicesIndexEssentialQueries(url?: URL) {
  const organizationId = await getStableDashboardOrganizationIdForRouteData()
  if (!organizationId) return []

  return [
    servicesListQueryOptions(
      servicesListQueryInputFromUrl(organizationId, url),
    ),
  ]
}

export async function loadServicesIndexData(
  queryClient: QueryClient,
  url?: URL,
) {
  await ensureRouteQueries(
    queryClient,
    await getServicesIndexEssentialQueries(url),
  )
}

export async function prewarmServicesIndex(
  queryClient: QueryClient,
  url?: URL,
) {
  await prewarmRouteQueries(
    queryClient,
    await getServicesIndexEssentialQueries(url),
  )
}

export async function loadServiceDetailData(
  queryClient: QueryClient,
  id: string,
) {
  await ensureRouteQueries(queryClient, [
    serviceDetailQueryOptions(id),
    serviceAuditLogQueryOptions(id),
  ])
}

export async function prewarmServiceDetail(
  queryClient: QueryClient,
  id: string,
) {
  await prewarmRouteQueries(queryClient, [
    serviceDetailQueryOptions(id),
    serviceAuditLogQueryOptions(id),
  ])
}

export async function loadServiceFormOptions(queryClient: QueryClient) {
  await ensureRouteQueries(queryClient, [
    publishedMethodsQueryOptions(),
    serviceAssetTypesQueryOptions(),
  ])
}

export async function loadServiceEditData(
  queryClient: QueryClient,
  id: string,
) {
  await ensureRouteQueries(queryClient, [
    serviceDetailQueryOptions(id),
    publishedMethodsQueryOptions(),
    serviceAssetTypesQueryOptions(),
    serviceAuditLogQueryOptions(id),
  ])
}

export async function prewarmNewService(queryClient: QueryClient) {
  await prewarmRouteQueries(queryClient, [
    publishedMethodsQueryOptions(),
    serviceAssetTypesQueryOptions(),
  ])
}

export async function prewarmServiceEdit(queryClient: QueryClient, id: string) {
  await prewarmRouteQueries(queryClient, [
    serviceDetailQueryOptions(id),
    publishedMethodsQueryOptions(),
    serviceAssetTypesQueryOptions(),
    serviceAuditLogQueryOptions(id),
  ])
}

export function useServicesListData({
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
  statusFilter: ServicesListStatus | ''
}) {
  return useQuery({
    ...servicesListQueryOptions({
      organizationId: activeOrganizationId ?? 'no-org',
      page,
      limit,
      search,
      statusFilter,
    }),
    enabled: Boolean(activeOrganizationId) && enabled,
  })
}

export function useServiceDetailData(id: string) {
  return useQuery(serviceDetailQueryOptions(id))
}

export function useServiceAuditLogData(id: string) {
  return useQuery(serviceAuditLogQueryOptions(id))
}

export function usePublishedMethodsData() {
  return useQuery(publishedMethodsQueryOptions())
}

export function useServiceAssetTypesData() {
  return useQuery(serviceAssetTypesQueryOptions())
}
