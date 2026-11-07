import type { JobStatus } from '@calibra-facil/schemas'
import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query'

import { calibraApi } from '@/utils/api'
import { keepPreviousDataInScope } from '@calibra-facil/shared/query-scope'
import {
  ensureRouteQueries,
  getStableDashboardOrganizationIdForRouteData,
  prewarmRouteQueries,
} from '@/lib/route-data'
import { pageFromUrl } from '@/lib/url-search'
import type {
  CustomerAssetsData,
  CustomerAuditLogData,
  CustomerJobsData,
  CustomersListData,
  CustomersListQueryInput,
} from './types'
import { customerKeys } from '@/features/customers/keys'
import { assetKeys } from '@/features/assets/keys'
import { jobKeys } from '@/features/jobs/keys'

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
    queryKey: customerKeys.list(input),
    queryFn: (): Promise<CustomersListData> =>
      calibraApi.customers.list({
        query: {
          page: input.page,
          limit: input.limit,
          query: input.search || undefined,
        },
      }),
    placeholderData: keepPreviousDataInScope(
      customerKeys.listScope(input.organizationId),
    ),
  })
}

function customersSearchQueryOptions(organizationId: string, search = '') {
  return queryOptions({
    queryKey: customerKeys.search(organizationId, search),
    queryFn: (): Promise<CustomersListData> =>
      calibraApi.customers.list({
        query: { page: 1, limit: 50, query: search || undefined },
      }),
    staleTime: 30_000,
  })
}

export async function prewarmCustomersSearch(
  queryClient: QueryClient,
  organizationId: string,
) {
  await prewarmRouteQueries(queryClient, [
    customersSearchQueryOptions(organizationId),
  ])
}

export function customerDetailQueryOptions(id: string) {
  return queryOptions({
    queryKey: customerKeys.detail(id),
    queryFn: () => calibraApi.customers.get({ params: { id } }),
  })
}

export function customerFinancialTimelineQueryOptions(id: string) {
  return queryOptions({
    queryKey: customerKeys.financialTimeline(id),
    queryFn: () =>
      calibraApi.finance.getCustomerTimeline({ params: { customerId: id } }),
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
    queryKey: assetKeys.customerList({
      customerId: customerId,
      page: page,
      limit: limit,
      search: search,
    }),
    queryFn: (): Promise<CustomerAssetsData> => {
      if (customerId === undefined) {
        return Promise.resolve({ data: [] } satisfies CustomerAssetsData)
      }

      return calibraApi.assets.list({
        query: {
          page,
          limit,
          customerId,
          query: search || undefined,
        },
      })
    },
    placeholderData: keepPreviousDataInScope(
      assetKeys.customerListScope(customerId),
    ),
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
  statusFilter: JobStatus | ''
}) {
  return queryOptions({
    queryKey: jobKeys.forCustomer({
      customerId: customerId,
      page: page,
      search: search,
      statusFilter: statusFilter,
    }),
    queryFn: (): Promise<CustomerJobsData> => {
      if (customerId === undefined) {
        return Promise.resolve({
          data: [],
          pagination: { page, limit, total: 0, totalPages: 0 },
        } satisfies CustomerJobsData)
      }

      return calibraApi.jobs.list({
        query: {
          page,
          limit,
          customerId,
          query: search || undefined,
          status: statusFilter || undefined,
        },
      })
    },
    placeholderData: keepPreviousDataInScope(
      jobKeys.forCustomerScope(customerId),
    ),
  })
}

export function customerAuditLogQueryOptions(id: string) {
  return queryOptions({
    queryKey: customerKeys.auditLog(id),
    queryFn: (): Promise<CustomerAuditLogData> =>
      calibraApi.customers.auditLog({
        params: { id },
        query: { page: 1, limit: 50 },
      }),
  })
}

export function customerMembersQueryOptions(id: string) {
  return queryOptions({
    queryKey: customerKeys.members(id),
    queryFn: () => calibraApi.customers.listMembers({ params: { id } }),
  })
}

export function customerInvitationsQueryOptions(id: string) {
  return queryOptions({
    queryKey: customerKeys.invitations(id),
    queryFn: () => calibraApi.customers.listInvitations({ params: { id } }),
  })
}

async function getCustomersIndexEssentialQueries(url?: URL) {
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

export async function loadCustomerOverviewData(
  queryClient: QueryClient,
  id: string,
) {
  // Land on a fully-populated overview (no skeleton pop): resolve the customer
  // first to get the numeric id the asset/job lists need, then fan out.
  const customer = await queryClient.ensureQueryData(
    customerDetailQueryOptions(id),
  )
  await ensureRouteQueries(queryClient, [
    customerAssetsQueryOptions({
      customerId: customer.id,
      page: 1,
      limit: 100,
      search: '',
    }),
    customerJobsQueryOptions({
      customerId: customer.id,
      page: 1,
      limit: 5,
      search: '',
      statusFilter: '',
    }),
    customerMembersQueryOptions(id),
    customerInvitationsQueryOptions(id),
  ])
}

export async function loadCustomerAssetsData(
  queryClient: QueryClient,
  id: string,
) {
  const customer = await queryClient.ensureQueryData(
    customerDetailQueryOptions(id),
  )
  await ensureRouteQueries(queryClient, [
    customerAssetsQueryOptions({
      customerId: customer.id,
      page: 1,
      limit: CUSTOMERS_LIST_LIMIT,
      search: '',
    }),
  ])
}

export async function loadCustomerCalibrationsData(
  queryClient: QueryClient,
  id: string,
) {
  const customer = await queryClient.ensureQueryData(
    customerDetailQueryOptions(id),
  )
  await ensureRouteQueries(queryClient, [
    customerJobsQueryOptions({
      customerId: customer.id,
      page: 1,
      limit: CUSTOMERS_LIST_LIMIT,
      search: '',
      statusFilter: '',
    }),
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
  statusFilter: JobStatus | ''
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
