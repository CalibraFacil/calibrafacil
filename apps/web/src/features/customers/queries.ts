import type { JobStatus } from '@calibra-facil/schemas'
import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query'

import { calibraApi } from '@/utils/api'
import { operation } from '@calibra-facil/client-runtime'
import { useAvailability } from '@/runtime/use-operation-availability'
import { keepPreviousDataInScope } from '@calibra-facil/shared/query-scope'
import {
  ensureRouteQueries,
  getStableDashboardOrganizationIdForRouteData,
  prewarmRouteQueries,
  routeData,
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

/** The customer picker of the job and asset forms: the first 50 matches of a search. */
export function customerPickerQueryOptions(search = '') {
  return queryOptions({
    queryKey: customerKeys.pickerSearch(search),
    queryFn: (): Promise<CustomersListData> =>
      calibraApi.customers.list({
        query: { page: 1, limit: 50, query: search || undefined },
      }),
    staleTime: 30_000,
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
    queryKey: customerKeys.assetsPage({
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
      customerKeys.assetsPageScope(customerId),
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
    queryKey: customerKeys.jobsPage({
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
      customerKeys.jobsPageScope(customerId),
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

const customersIndexRouteData = routeData((url?: URL) =>
  getCustomersIndexEssentialQueries(url),
)
export const loadCustomersIndexData = customersIndexRouteData.load
export const prewarmCustomersIndex = customersIndexRouteData.prewarm

const customerDetailRouteData = routeData((id: string) => [
  customerDetailQueryOptions(id),
])
export const loadCustomerDetailData = customerDetailRouteData.load
export const prewarmCustomerDetail = customerDetailRouteData.prewarm

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

const customerComplianceRouteData = routeData((id: string) => [
  customerDetailQueryOptions(id),
  customerAuditLogQueryOptions(id),
])
export const loadCustomerComplianceData = customerComplianceRouteData.load
export const prewarmCustomerCompliance = customerComplianceRouteData.prewarm

const customerUsersRouteData = routeData((id: string) => [
  customerMembersQueryOptions(id),
  customerInvitationsQueryOptions(id),
])
export const loadCustomerUsersData = customerUsersRouteData.load
export const prewarmCustomerUsers = customerUsersRouteData.prewarm

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

// Finance is a cloud module: the timeline is read, and its block is shown, only
// while this call can run.
const FINANCIAL_TIMELINE_OPERATIONS = [
  operation('finance', 'getCustomerTimeline'),
] as const

/** A customer's financial timeline, with whether finance is available here (the query's gate, and what the screen shows). */
export function useCustomerFinancialTimelineData({ id }: { id: string }) {
  const available = useAvailability(FINANCIAL_TIMELINE_OPERATIONS)
  const query = useQuery({
    ...customerFinancialTimelineQueryOptions(id),
    enabled: available,
  })

  return { query, available }
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
