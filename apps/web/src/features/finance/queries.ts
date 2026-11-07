import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query'

import { calibraApi } from '@/utils/api'
import { ensureRouteQueries, prewarmRouteQueries } from '@/lib/route-data'
import type {
  FinanceBillingMode,
  FinanceContractCustomerOptionsData,
  FinanceContractServiceOptionsData,
  FinanceSearchQueryInput,
} from './types'
import { financeKeys } from '@/features/finance/keys'

function searchFromUrl(url?: URL) {
  return url?.searchParams.get('query') ?? ''
}

export function financeSearchInputFromUrl(url?: URL) {
  return {
    search: searchFromUrl(url),
  } satisfies FinanceSearchQueryInput
}

export function financeOverviewQueryOptions() {
  return queryOptions({
    queryKey: financeKeys.overview,
    queryFn: () => calibraApi.finance.getOverview(),
  })
}

export function financeDocumentsQueryOptions(input: FinanceSearchQueryInput) {
  return queryOptions({
    queryKey: financeKeys.documentSearch(input.search),
    queryFn: () =>
      calibraApi.finance.listDocuments({
        query: { query: input.search || undefined },
      }),
  })
}

export function financeContractsQueryOptions(input: FinanceSearchQueryInput) {
  return queryOptions({
    queryKey: financeKeys.contractSearch(input.search),
    queryFn: () =>
      calibraApi.finance.listContracts({
        query: { query: input.search || undefined },
      }),
  })
}

export function financeDocumentDetailQueryOptions(id: string | number) {
  return queryOptions({
    queryKey: financeKeys.documentDetail(id),
    queryFn: () => calibraApi.finance.getDocument({ params: { id } }),
  })
}

export function financeContractDetailQueryOptions(id: string | number) {
  return queryOptions({
    queryKey: financeKeys.contractDetail(id),
    queryFn: () => calibraApi.finance.getContract({ params: { id } }),
  })
}

export function financeReceiptsQueryOptions() {
  return queryOptions({
    queryKey: financeKeys.receipts,
    queryFn: () => calibraApi.finance.listReceipts(),
  })
}

export function financeErpQueryOptions() {
  return queryOptions({
    queryKey: financeKeys.erp,
    queryFn: () => calibraApi.finance.listErpExports(),
  })
}

function financeBillingReadinessQueryOptions(input: { status?: string } = {}) {
  return queryOptions({
    queryKey: financeKeys.billingReadinessFor(input.status),
    queryFn: () =>
      calibraApi.finance.listBillingReadiness({
        query: { status: input.status || undefined },
      }),
  })
}

export function financeEligibleJobsQueryOptions({
  mode,
  search,
}: {
  mode: FinanceBillingMode
  search: string
}) {
  return queryOptions({
    queryKey: financeKeys.eligibleJobs(mode, search),
    queryFn: () =>
      calibraApi.finance.listEligibleJobs({
        query: { mode, query: search || undefined, limit: 100 },
      }),
  })
}

export function financeContractCustomerOptionsQueryOptions() {
  return queryOptions({
    queryKey: financeKeys.contractFormCustomers,
    queryFn: async (): Promise<FinanceContractCustomerOptionsData> =>
      calibraApi.customers.list({
        query: {
          page: 1,
          limit: 100,
        },
      }),
  })
}

export function financeContractServiceOptionsQueryOptions() {
  return queryOptions({
    queryKey: financeKeys.contractFormServices,
    queryFn: async (): Promise<FinanceContractServiceOptionsData> =>
      calibraApi.services.list({
        query: {
          page: 1,
          limit: 100,
          isActive: true,
        },
      }),
  })
}

export async function loadFinanceOverviewData(queryClient: QueryClient) {
  await ensureRouteQueries(queryClient, [financeOverviewQueryOptions()])
}

export async function prewarmFinanceOverview(queryClient: QueryClient) {
  await prewarmRouteQueries(queryClient, [financeOverviewQueryOptions()])
}

export async function loadFinanceDocumentsData(
  queryClient: QueryClient,
  url?: URL,
) {
  await ensureRouteQueries(queryClient, [
    financeDocumentsQueryOptions(financeSearchInputFromUrl(url)),
  ])
}

export async function prewarmFinanceDocuments(
  queryClient: QueryClient,
  url?: URL,
) {
  await prewarmRouteQueries(queryClient, [
    financeDocumentsQueryOptions(financeSearchInputFromUrl(url)),
  ])
}

export async function prewarmFinanceDocumentDetail(
  queryClient: QueryClient,
  id: string | number,
) {
  await prewarmRouteQueries(queryClient, [
    financeDocumentDetailQueryOptions(id),
  ])
}

export async function loadFinanceContractsData(
  queryClient: QueryClient,
  url?: URL,
) {
  await ensureRouteQueries(queryClient, [
    financeContractsQueryOptions(financeSearchInputFromUrl(url)),
  ])
}

export async function prewarmFinanceContracts(
  queryClient: QueryClient,
  url?: URL,
) {
  await prewarmRouteQueries(queryClient, [
    financeContractsQueryOptions(financeSearchInputFromUrl(url)),
  ])
}

export async function prewarmFinanceContractDetail(
  queryClient: QueryClient,
  id: string | number,
) {
  await prewarmRouteQueries(queryClient, [
    financeContractDetailQueryOptions(id),
  ])
}

export async function loadFinanceReceiptsData(queryClient: QueryClient) {
  await ensureRouteQueries(queryClient, [financeReceiptsQueryOptions()])
}

export async function prewarmFinanceReceipts(queryClient: QueryClient) {
  await prewarmRouteQueries(queryClient, [financeReceiptsQueryOptions()])
}

export async function loadFinanceErpData(queryClient: QueryClient) {
  await ensureRouteQueries(queryClient, [financeErpQueryOptions()])
}

export async function prewarmFinanceErp(queryClient: QueryClient) {
  await prewarmRouteQueries(queryClient, [financeErpQueryOptions()])
}

export async function loadFinanceBillingReadinessData(
  queryClient: QueryClient,
) {
  await ensureRouteQueries(queryClient, [financeBillingReadinessQueryOptions()])
}

export async function prewarmNewFinanceDocument(queryClient: QueryClient) {
  await prewarmRouteQueries(queryClient, [
    financeEligibleJobsQueryOptions({ mode: 'single', search: '' }),
  ])
}

export async function prewarmNewFinanceContract(queryClient: QueryClient) {
  await prewarmRouteQueries(queryClient, [
    financeContractCustomerOptionsQueryOptions(),
    financeContractServiceOptionsQueryOptions(),
  ])
}

export function useFinanceOverviewData() {
  return useQuery(financeOverviewQueryOptions())
}

export function useFinanceDocumentsData(input: FinanceSearchQueryInput) {
  return useQuery(financeDocumentsQueryOptions(input))
}

export function useFinanceContractsData(input: FinanceSearchQueryInput) {
  return useQuery(financeContractsQueryOptions(input))
}

export function useFinanceDocumentDetailData(id: string | number) {
  return useQuery(financeDocumentDetailQueryOptions(id))
}

export function useFinanceContractDetailData(id: string | number) {
  return useQuery(financeContractDetailQueryOptions(id))
}

export function useFinanceReceiptsData() {
  return useQuery(financeReceiptsQueryOptions())
}

export function useFinanceErpData() {
  return useQuery(financeErpQueryOptions())
}

export function useFinanceBillingReadinessData(
  input: { status?: string } = {},
) {
  return useQuery(financeBillingReadinessQueryOptions(input))
}

export function useFinanceEligibleJobsData({
  mode,
  search,
}: {
  mode: FinanceBillingMode
  search: string
}) {
  return useQuery(financeEligibleJobsQueryOptions({ mode, search }))
}

export function useFinanceContractCustomerOptionsData() {
  return useQuery(financeContractCustomerOptionsQueryOptions())
}

export function useFinanceContractServiceOptionsData() {
  return useQuery(financeContractServiceOptionsQueryOptions())
}
