import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query'

import { prewarmRouteQueries } from '@/lib/route-data'
import { calibraApi } from '@/utils/api'
import type { SuccessProfileResponse, SupportRequestsResponse } from './types'

export function customerSuccessProfileQueryOptions() {
  return queryOptions({
    queryKey: ['customer-success', 'profile'],
    queryFn: () =>
      calibraApi.customerSuccess.getProfile<SuccessProfileResponse>(),
  })
}

export function customerSuccessRequestsQueryOptions() {
  return queryOptions({
    queryKey: ['customer-success', 'requests'],
    queryFn: () =>
      calibraApi.customerSuccess.listRequests<SupportRequestsResponse>(),
  })
}

export async function prewarmCustomerSuccess(queryClient: QueryClient) {
  await prewarmRouteQueries(queryClient, [
    customerSuccessProfileQueryOptions(),
    customerSuccessRequestsQueryOptions(),
  ])
}

export function useCustomerSuccessProfileData() {
  return useQuery(customerSuccessProfileQueryOptions())
}

export function useCustomerSuccessRequestsData() {
  return useQuery(customerSuccessRequestsQueryOptions())
}
