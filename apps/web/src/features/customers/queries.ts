import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query'

import { calibraApi } from '@/utils/api'
import {
  ensureRouteQueries,
  getStableDashboardOrganizationIdForRouteData,
  prewarmRouteQueries,
} from '@/lib/route-data'
import { pageFromUrl } from '@/lib/url-search'
import type {
  CustomerAssetsData,
  CustomerAuditLogEntry,
  CustomerAuditLogData,
  CustomerDetail,
  CustomerJobsData,
  CustomerJobStatus,
  CustomerFinancialTimelineResponse,
  CustomersListData,
  CustomersListQueryInput,
  PortalInvitation,
  PortalMember,
} from './types'

export const CUSTOMERS_LIST_LIMIT = 20

export function customersListQueryInputFromUrl(
  organizationId: string,
  url?: URL,
) {
  return {
    organizationId,
    page: pageFromUrl(url),
    limit: CUSTOMERS_LIST_LIMIT,
    search: url?.searchParams.get('query') ?? '',
  } satisfies CustomersListQueryInput
}

export function customersListQueryOptions(input: CustomersListQueryInput) {
  return queryOptions({
    queryKey: [
      'customers',
      input.organizationId,
      input.page,
      input.limit,
      input.search,
    ],
    queryFn: (): Promise<CustomersListData> =>
      calibraApi.customers.list({
        page: input.page,
        limit: input.limit,
        query: input.search || undefined,
      }),
  })
}

export function customersSearchQueryOptions(
  organizationId: string,
  search = '',
) {
  return queryOptions({
    queryKey: ['customers', organizationId, 'search', search],
    queryFn: (): Promise<CustomersListData> =>
      calibraApi.customers.list({
        page: 1,
        limit: 50,
        query: search || undefined,
      }),
    staleTime: 30_000,
  })
}

export function customerDetailQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['customer', id],
    queryFn: () => calibraApi.customers.get<CustomerDetail>(id),
  })
}

export function customerFinancialTimelineQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['customer', id, 'financial-timeline'],
    queryFn: () =>
      calibraApi.finance.getCustomerTimeline<CustomerFinancialTimelineResponse>(
        id,
      ),
  })
}

export function customerAssetsQueryOptions({
  customerId,
  page,
  limit,
  search,
}: {
  customerId: number | undefined
  page: number
  limit: number
  search: string
}) {
  return queryOptions({
    queryKey: ['assets', 'customer', customerId, page, limit, search],
    queryFn: (): Promise<CustomerAssetsData> => {
      if (customerId === undefined) {
        return Promise.resolve({ data: [] } satisfies CustomerAssetsData)
      }

      return calibraApi.assets.list({
        page,
        limit,
        customerId,
        query: search || undefined,
      })
    },
  })
}

export function customerJobsQueryOptions({
  customerId,
  page,
  limit,
  search,
  statusFilter,
}: {
  customerId: number | undefined
  page: number
  limit: number
  search: string
  statusFilter: CustomerJobStatus | ''
}) {
  return queryOptions({
    queryKey: ['jobs', 'customer', customerId, page, search, statusFilter],
    queryFn: (): Promise<CustomerJobsData> => {
      if (customerId === undefined) {
        return Promise.resolve({
          data: [],
          pagination: { page, limit, total: 0, totalPages: 0 },
        } satisfies CustomerJobsData)
      }

      return calibraApi.jobs.list({
        page,
        limit,
        customerId,
        query: search || undefined,
        status: statusFilter || undefined,
      })
    },
  })
}

export function customerAuditLogQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['customer-audit-log', id],
    queryFn: (): Promise<CustomerAuditLogData> =>
      calibraApi.customers.auditLog<CustomerAuditLogEntry>(id, {
        page: 1,
        limit: 50,
      }),
  })
}

export function customerMembersQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['customer-members', id],
    queryFn: () => calibraApi.customers.listMembers<PortalMember>(id),
  })
}

export function customerInvitationsQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['customer-invitations', id],
    queryFn: () => calibraApi.customers.listInvitations<PortalInvitation>(id),
  })
}

export async function getCustomersIndexEssentialQueries(url?: URL) {
  const organizationId = await getStableDashboardOrganizationIdForRouteData()
  if (!organizationId) return []

  return [
    customersListQueryOptions(
      customersListQueryInputFromUrl(organizationId, url),
    ),
  ]
}

export async function loadCustomersIndexData(
  queryClient: QueryClient,
  url?: URL,
) {
  await ensureRouteQueries(
    queryClient,
    await getCustomersIndexEssentialQueries(url),
  )
}

export async function prewarmCustomersIndex(
  queryClient: QueryClient,
  url?: URL,
) {
  await prewarmRouteQueries(
    queryClient,
    await getCustomersIndexEssentialQueries(url),
  )
}

export async function loadCustomerDetailData(
  queryClient: QueryClient,
  id: string,
) {
  await ensureRouteQueries(queryClient, [customerDetailQueryOptions(id)])
}

export async function prewarmCustomerDetail(
  queryClient: QueryClient,
  id: string,
) {
  await prewarmRouteQueries(queryClient, [customerDetailQueryOptions(id)])
}

export async function prewarmCustomerAssets(
  queryClient: QueryClient,
  id: string,
) {
  const customerId = Number(id)

  await Promise.all([
    prewarmCustomerDetail(queryClient, id),
    prewarmRouteQueries(queryClient, [
      Number.isFinite(customerId)
        ? customerAssetsQueryOptions({
            customerId,
            page: 1,
            limit: CUSTOMERS_LIST_LIMIT,
            search: '',
          })
        : null,
    ]),
  ])
}

export async function prewarmCustomerCompliance(
  queryClient: QueryClient,
  id: string,
) {
  await prewarmRouteQueries(queryClient, [
    customerDetailQueryOptions(id),
    customerAuditLogQueryOptions(id),
  ])
}

export async function prewarmCustomerUsers(
  queryClient: QueryClient,
  id: string,
) {
  await prewarmRouteQueries(queryClient, [
    customerMembersQueryOptions(id),
    customerInvitationsQueryOptions(id),
  ])
}

export async function loadCustomerComplianceData(
  queryClient: QueryClient,
  id: string,
) {
  await ensureRouteQueries(queryClient, [
    customerDetailQueryOptions(id),
    customerAuditLogQueryOptions(id),
  ])
}

export async function loadCustomerUsersData(
  queryClient: QueryClient,
  id: string,
) {
  await ensureRouteQueries(queryClient, [
    customerMembersQueryOptions(id),
    customerInvitationsQueryOptions(id),
  ])
}

export function useCustomersListData({
  activeOrganizationId,
  enabled,
  page,
  limit,
  search,
}: {
  activeOrganizationId: string | null
  enabled: boolean
  page: number
  limit: number
  search: string
}) {
  return useQuery({
    ...customersListQueryOptions({
      organizationId: activeOrganizationId ?? 'no-org',
      page,
      limit,
      search,
    }),
    enabled: Boolean(activeOrganizationId) && enabled,
  })
}

export function useCustomersSearchData({
  activeOrganizationId,
  enabled,
  search,
}: {
  activeOrganizationId: string | null
  enabled: boolean
  search: string
}) {
  return useQuery({
    ...customersSearchQueryOptions(activeOrganizationId ?? 'no-org', search),
    enabled: Boolean(activeOrganizationId) && enabled,
  })
}

export function useCustomerDetailData(id: string) {
  return useQuery(customerDetailQueryOptions(id))
}

export function useCustomerFinancialTimelineData({
  enabled,
  id,
}: {
  enabled: boolean
  id: string
}) {
  return useQuery({
    ...customerFinancialTimelineQueryOptions(id),
    enabled,
  })
}

export function useCustomerAssetsData({
  customerId,
  page,
  limit,
  search,
}: {
  customerId: number | undefined
  page: number
  limit: number
  search: string
}) {
  return useQuery({
    ...customerAssetsQueryOptions({ customerId, page, limit, search }),
    enabled: customerId !== undefined,
  })
}

export function useCustomerJobsData({
  customerId,
  page,
  limit,
  search,
  statusFilter,
}: {
  customerId: number | undefined
  page: number
  limit: number
  search: string
  statusFilter: CustomerJobStatus | ''
}) {
  return useQuery({
    ...customerJobsQueryOptions({
      customerId,
      page,
      limit,
      search,
      statusFilter,
    }),
    enabled: customerId !== undefined,
  })
}

export function useCustomerAuditLogData(id: string) {
  return useQuery(customerAuditLogQueryOptions(id))
}

export function useCustomerMembersData(id: string) {
  return useQuery(customerMembersQueryOptions(id))
}

export function useCustomerInvitationsData(id: string) {
  return useQuery(customerInvitationsQueryOptions(id))
}
