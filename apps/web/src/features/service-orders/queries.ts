import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query'

import type { MaterialsListData } from '@calibra-facil/client-runtime'
import { calibraApi } from '@/utils/api'
import {
  ensureRouteQueries,
  getStableDashboardOrganizationIdForRouteData,
  prewarmRouteQueries,
} from '@/lib/route-data'
import { optionFromUrl, pageFromUrl } from '@/lib/url-search'
import {
  type NewServiceOrderAssetsData,
  type NewServiceOrderCustomersData,
  SERVICE_ORDER_STATUSES,
  type ServiceOrderDetail,
  type ServiceOrderFinancialStatusResponse,
  type ServiceOrdersListData,
  type ServiceOrdersListQueryInput,
  type ServiceOrderStatus,
} from './types'

export const SERVICE_ORDERS_LIST_LIMIT = 20

function statusFromUrl(url?: URL): ServiceOrderStatus | '' {
  return optionFromUrl(SERVICE_ORDER_STATUSES, url?.searchParams.get('status'))
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
      // oxlint-disable-next-line typescript/consistent-type-assertions -- legacy service-order list DTOs need a runtime normalizer before this view-model cast can be removed.
      calibraApi.serviceOrders.list({
        page: input.page,
        limit: input.limit,
        query: input.search || undefined,
        status: input.statusFilter || undefined,
      }) as Promise<ServiceOrdersListData>,
  })
}

/**
 * Keyed and fetched by the OPAQUE publicId — the dashboard routes with it so a
 * URL never carries the enumerable serial. Mutations still take the numeric id,
 * which callers read off the loaded detail.
 */
export function serviceOrderDetailQueryOptions(publicId: string) {
  return queryOptions({
    queryKey: ['service-order', publicId],
    queryFn: () =>
      // oxlint-disable-next-line typescript/consistent-type-assertions -- legacy service-order detail DTOs need a runtime normalizer before this view-model cast can be removed.
      calibraApi.serviceOrders.getByPublicId(
        publicId,
      ) as Promise<ServiceOrderDetail>,
  })
}

export function serviceOrderCommunicationsQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['service-order', id, 'communications'],
    queryFn: () => calibraApi.serviceOrders.listCommunications(id),
  })
}

export function serviceOrderFinancialStatusQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['service-order', id, 'financial-status'],
    queryFn: () =>
      calibraApi.finance.getServiceOrderStatus<ServiceOrderFinancialStatusResponse>(
        id,
      ),
  })
}

export function newServiceOrderCustomersQueryOptions(search = '') {
  return queryOptions({
    queryKey: ['customers', 'service-order-open', search],
    queryFn: async (): Promise<NewServiceOrderCustomersData> => {
      const result = await calibraApi.customers.list({
        page: 1,
        limit: 100,
        query: search.trim() || undefined,
      })
      return {
        data: result.data.map((customer) => ({
          id: customer.id,
          name: customer.name,
          taxId: customer.taxId,
          email: customer.email,
          phone: customer.phone ?? null,
          compliance: customer.compliance,
        })),
      }
    },
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
      })
    },
  })
}

export const SERVICE_ORDER_MATERIAL_PICKER_LIMIT = 20

// Typeahead over the active material catalog for the SO part-item picker.
// Keyed on the typed query so the debounce is data-driven (no useEffect). On
// desktop/offline `calibraApi.materials.list` returns `{ data: [] }`, so the
// picker degrades to free-text with no error surfaced.
export function fetchServiceOrderMaterials(
  search = '',
): Promise<MaterialsListData> {
  return calibraApi.materials.list({
    page: 1,
    limit: SERVICE_ORDER_MATERIAL_PICKER_LIMIT,
    query: search.trim() || undefined,
    isActive: true,
  })
}

export function serviceOrderMaterialsQueryOptions(search = '') {
  return queryOptions({
    queryKey: ['materials', 'service-order-picker', search],
    queryFn: () => fetchServiceOrderMaterials(search),
  })
}

export function useServiceOrderMaterialsData(search = '') {
  return useQuery(serviceOrderMaterialsQueryOptions(search))
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

export function useServiceOrderCommunicationsData({
  enabled,
  id,
}: {
  enabled: boolean
  id: string
}) {
  return useQuery({
    ...serviceOrderCommunicationsQueryOptions(id),
    enabled,
  })
}

export function useServiceOrderFinancialStatusData({
  enabled,
  id,
}: {
  enabled: boolean
  id: string
}) {
  return useQuery({
    ...serviceOrderFinancialStatusQueryOptions(id),
    enabled,
  })
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
