import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query'

import { calibraApi } from '@/utils/api'
import {
  ensureRouteQueries,
  getStableDashboardOrganizationIdForRouteData,
  prewarmRouteQueries,
} from '@/lib/route-data'
import {
  type NewServiceOrderAssetsData,
  type NewServiceOrderCustomersData,
  SERVICE_ORDER_STATUSES,
  type ServiceOrderDetail,
  type ServiceOrdersListData,
  type ServiceOrdersListQueryInput,
  type ServiceOrderStatus,
} from './types'

export const SERVICE_ORDERS_LIST_LIMIT = 20

function pageFromUrl(url?: URL) {
  const page = Number(url?.searchParams.get('page') ?? 1)
  return Number.isFinite(page) && page > 0 ? page : 1
}

function statusFromUrl(url?: URL): ServiceOrderStatus | '' {
  const status = url?.searchParams.get('status') ?? ''

  return SERVICE_ORDER_STATUSES.includes(status as ServiceOrderStatus)
    ? (status as ServiceOrderStatus)
    : ''
}

export function serviceOrdersListQueryInputFromUrl(
  organizationId: string,
  url?: URL,
) {
  return {
    organizationId,
    page: pageFromUrl(url),
    limit: SERVICE_ORDERS_LIST_LIMIT,
    search: url?.searchParams.get('query') ?? '',
    statusFilter: statusFromUrl(url),
  } satisfies ServiceOrdersListQueryInput
}

export function serviceOrdersListQueryOptions(
  input: ServiceOrdersListQueryInput,
) {
  return queryOptions({
    queryKey: [
      'service-orders',
      input.organizationId,
      input.page,
      input.search,
      input.statusFilter,
    ],
    queryFn: () =>
      calibraApi.serviceOrders.list({
        page: input.page,
        limit: input.limit,
        query: input.search || undefined,
        status: input.statusFilter || undefined,
      }) as Promise<ServiceOrdersListData>,
  })
}

export function serviceOrderDetailQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['service-order', id],
    queryFn: () =>
      calibraApi.serviceOrders.get(id) as Promise<ServiceOrderDetail>,
  })
}

export function newServiceOrderCustomersQueryOptions(search = '') {
  return queryOptions({
    queryKey: ['customers', 'service-order-open', search],
    queryFn: () =>
      calibraApi.customers.list({
        page: 1,
        limit: 100,
        query: search.trim() || undefined,
      }) as Promise<NewServiceOrderCustomersData>,
  })
}

export function newServiceOrderAssetsQueryOptions({
  customerId,
  search = '',
}: {
  customerId: number | null
  search?: string
}) {
  return queryOptions({
    queryKey: ['assets', 'service-order-open', customerId, search],
    queryFn: () => {
      if (!customerId) {
        return Promise.resolve({ data: [] } satisfies NewServiceOrderAssetsData)
      }

      return calibraApi.assets.list({
        page: 1,
        limit: 100,
        customerId,
        query: search.trim() || undefined,
      }) as Promise<NewServiceOrderAssetsData>
    },
  })
}

export async function getServiceOrderIntakeDocumentUrl(id: string) {
  const result = await calibraApi.serviceOrders.getIntakeDocumentPdf(id)
  return result.url
}

export async function getServiceOrderTagDocumentUrl(id: string) {
  const result = await calibraApi.serviceOrders.getTagPdf(id)
  return result.url
}

export async function getServiceOrderDeliveryDocumentUrl(id: string) {
  const result = await calibraApi.serviceOrders.getDeliveryDocumentPdf(id)
  return result.url
}

export async function getServiceOrdersIndexEssentialQueries(url?: URL) {
  const organizationId = await getStableDashboardOrganizationIdForRouteData()
  if (!organizationId) return []

  return [
    serviceOrdersListQueryOptions(
      serviceOrdersListQueryInputFromUrl(organizationId, url),
    ),
  ]
}

export async function loadServiceOrdersIndexData(
  queryClient: QueryClient,
  url?: URL,
) {
  await ensureRouteQueries(
    queryClient,
    await getServiceOrdersIndexEssentialQueries(url),
  )
}

export async function prewarmServiceOrdersIndex(
  queryClient: QueryClient,
  url?: URL,
) {
  await prewarmRouteQueries(
    queryClient,
    await getServiceOrdersIndexEssentialQueries(url),
  )
}

export async function loadServiceOrderDetailData(
  queryClient: QueryClient,
  id: string,
) {
  await ensureRouteQueries(queryClient, [serviceOrderDetailQueryOptions(id)])
}

export async function prewarmServiceOrderDetail(
  queryClient: QueryClient,
  id: string,
) {
  await prewarmRouteQueries(queryClient, [serviceOrderDetailQueryOptions(id)])
}

export async function loadNewServiceOrderData(queryClient: QueryClient) {
  await ensureRouteQueries(queryClient, [
    newServiceOrderCustomersQueryOptions(''),
  ])
}

export async function prewarmNewServiceOrder(queryClient: QueryClient) {
  await prewarmRouteQueries(queryClient, [
    newServiceOrderCustomersQueryOptions(''),
  ])
}

export function useServiceOrdersListData({
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
  statusFilter: ServiceOrderStatus | ''
}) {
  return useQuery({
    ...serviceOrdersListQueryOptions({
      organizationId: activeOrganizationId ?? 'no-org',
      page,
      limit,
      search,
      statusFilter,
    }),
    enabled: Boolean(activeOrganizationId) && enabled,
  })
}

export function useServiceOrderDetailData(id: string) {
  return useQuery(serviceOrderDetailQueryOptions(id))
}

export function useNewServiceOrderCustomersData(search = '') {
  return useQuery(newServiceOrderCustomersQueryOptions(search))
}

export function useNewServiceOrderAssetsData({
  customerId,
  search = '',
}: {
  customerId: number | null
  search?: string
}) {
  return useQuery({
    ...newServiceOrderAssetsQueryOptions({ customerId, search }),
    enabled: Boolean(customerId),
  })
}
