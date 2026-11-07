import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query'

import type { MaterialsListData } from '@calibra-facil/client-runtime'
import {
  SERVICE_ORDER_STATUS,
  type ServiceOrderStatus,
} from '@calibra-facil/shared'
import { calibraApi } from '@/utils/api'
import { keepPreviousDataInScope } from '@calibra-facil/shared/query-scope'
import {
  ensureRouteQueries,
  getStableDashboardOrganizationIdForRouteData,
  prewarmRouteQueries,
} from '@/lib/route-data'
import { optionFromUrl, pageFromUrl } from '@/lib/url-search'
import {
  type NewServiceOrderAssetsData,
  type NewServiceOrderCustomersData,
  type ServiceOrdersListQueryInput,
} from './types'
import { serviceOrderKeys } from '@/features/service-orders/keys'
import { customerKeys } from '@/features/customers/keys'
import { assetKeys } from '@/features/assets/keys'
import { materialKeys } from '@/features/materials/keys'

export const SERVICE_ORDERS_LIST_LIMIT = 20

function statusFromUrl(url?: URL): ServiceOrderStatus | '' {
  return optionFromUrl(
    SERVICE_ORDER_STATUS.states,
    url?.searchParams.get('status'),
  )
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
    queryKey: serviceOrderKeys.list(input),
    queryFn: () =>
      calibraApi.serviceOrders.list({
        query: {
          page: input.page,
          limit: input.limit,
          query: input.search || undefined,
          status: input.statusFilter || undefined,
        },
      }),
    placeholderData: keepPreviousDataInScope(
      serviceOrderKeys.listScope(input.organizationId),
    ),
  })
}

/**
 * Keyed and fetched by the OPAQUE publicId — the dashboard routes with it so a
 * URL never carries the enumerable serial. Mutations still take the numeric id,
 * which callers read off the loaded detail.
 */
export function serviceOrderDetailQueryOptions(publicId: string) {
  return queryOptions({
    queryKey: serviceOrderKeys.detail(publicId),
    queryFn: () =>
      calibraApi.serviceOrders.getByPublicId({
        params: { publicId },
      }),
  })
}

function serviceOrderCommunicationsQueryOptions(id: string) {
  return queryOptions({
    queryKey: serviceOrderKeys.communications(id),
    queryFn: () =>
      calibraApi.serviceOrders.listCommunications({ params: { id } }),
  })
}

export function serviceOrderFinancialStatusQueryOptions(id: string) {
  return queryOptions({
    queryKey: serviceOrderKeys.financialStatus(id),
    queryFn: () =>
      calibraApi.finance.getServiceOrderStatus({
        params: { serviceOrderId: id },
      }),
  })
}

export function newServiceOrderCustomersQueryOptions(search = '') {
  return queryOptions({
    queryKey: customerKeys.serviceOrderOpen(search),
    queryFn: async (): Promise<NewServiceOrderCustomersData> => {
      const result = await calibraApi.customers.list({
        query: {
          page: 1,
          limit: 100,
          query: search.trim() || undefined,
        },
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
    queryKey: assetKeys.serviceOrderOpen(customerId, search),
    queryFn: (): Promise<NewServiceOrderAssetsData> => {
      if (!customerId) {
        return Promise.resolve({ data: [] } satisfies NewServiceOrderAssetsData)
      }

      return calibraApi.assets.list({
        query: {
          page: 1,
          limit: 100,
          customerId,
          query: search.trim() || undefined,
        },
      })
    },
  })
}

const SERVICE_ORDER_MATERIAL_PICKER_LIMIT = 20

// Typeahead over the active material catalog for the SO part-item picker.
// Keyed on the typed query so the debounce is data-driven (no useEffect). On
// desktop/offline `calibraApi.materials.list` returns `{ data: [] }`, so the
// picker degrades to free-text with no error surfaced.
export function fetchServiceOrderMaterials(
  search = '',
): Promise<MaterialsListData> {
  return calibraApi.materials.list({
    query: {
      page: 1,
      limit: SERVICE_ORDER_MATERIAL_PICKER_LIMIT,
      query: search.trim() || undefined,
      isActive: true,
    },
  })
}

export function serviceOrderMaterialsQueryOptions(search = '') {
  return queryOptions({
    queryKey: materialKeys.serviceOrderPicker(search),
    queryFn: () => fetchServiceOrderMaterials(search),
  })
}

export function useServiceOrderMaterialsData(search = '') {
  return useQuery(serviceOrderMaterialsQueryOptions(search))
}

export async function getServiceOrderIntakeDocumentUrl(id: string) {
  const result = await calibraApi.serviceOrders.getIntakeDocumentPdf({
    params: { id },
  })
  return result.url
}

export async function getServiceOrderTagDocumentUrl(id: string) {
  const result = await calibraApi.serviceOrders.getTagPdf({ params: { id } })
  return result.url
}

export async function getServiceOrderDeliveryDocumentUrl(id: string) {
  const result = await calibraApi.serviceOrders.getDeliveryDocumentPdf({
    params: { id },
  })
  return result.url
}

async function getServiceOrdersIndexEssentialQueries(url?: URL) {
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
