import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query'

import { calibraApi } from '@/utils/api'
import { ensureRouteQueries, prewarmRouteQueries } from '@/lib/route-data'
import type {
  BillingDocumentsListData,
  BillingReadinessResponse,
  ErpExportsResponse,
  FinanceBillingMode,
  FinanceContractCustomerOptionsData,
  FinanceContractsListData,
  FinanceContractServiceOptionsData,
  FinanceEligibleJobsData,
  FinanceOverviewResponse,
  FinanceReceiptsData,
  FinanceSearchQueryInput,
} from './types'

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
    queryKey: ['finance', 'overview'],
    queryFn: () => calibraApi.finance.getOverview<FinanceOverviewResponse>(),
  })
}

export function financeDocumentsQueryOptions(input: FinanceSearchQueryInput) {
  return queryOptions({
    queryKey: ['finance', 'documents', input.search],
    queryFn: () =>
      calibraApi.finance.listDocuments<BillingDocumentsListData>({
        query: input.search || undefined,
      }),
  })
}

export function financeContractsQueryOptions(input: FinanceSearchQueryInput) {
  return queryOptions({
    queryKey: ['finance', 'contracts', input.search],
    queryFn: () =>
      calibraApi.finance.listContracts<FinanceContractsListData>({
        query: input.search || undefined,
      }),
  })
}

export function financeDocumentDetailQueryOptions<
  TResponse = { data: unknown },
>(id: string | number) {
  return queryOptions({
    queryKey: ['finance', 'documents', String(id)],
    queryFn: () => calibraApi.finance.getDocument<TResponse>(id),
  })
}

export function financeContractDetailQueryOptions<
  TResponse = { data: unknown },
>(id: string | number) {
  return queryOptions({
    queryKey: ['finance', 'contracts', String(id)],
    queryFn: () => calibraApi.finance.getContract<TResponse>(id),
  })
}

export function financeReceiptsQueryOptions() {
  return queryOptions({
    queryKey: ['finance', 'receipts'],
    queryFn: () => calibraApi.finance.listReceipts<FinanceReceiptsData>(),
  })
}

export function financeErpQueryOptions() {
  return queryOptions({
    queryKey: ['finance', 'erp'],
    queryFn: () => calibraApi.finance.listErpExports<ErpExportsResponse>(),
  })
}

export function financeBillingReadinessQueryOptions(
  input: { status?: string } = {},
) {
  return queryOptions({
    queryKey: ['finance', 'billing-readiness', input.status ?? 'all'],
    queryFn: () =>
      calibraApi.finance.listBillingReadiness<BillingReadinessResponse>({
        status: input.status || undefined,
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
    queryKey: ['finance', 'documents', 'eligible-jobs', mode, search],
    queryFn: () =>
      calibraApi.finance.listEligibleJobs<FinanceEligibleJobsData>({
        mode,
        query: search || undefined,
        limit: 100,
      }),
  })
}

export function financeContractCustomerOptionsQueryOptions() {
  return queryOptions({
    queryKey: ['finance', 'contract-form', 'customers'],
    queryFn: async (): Promise<FinanceContractCustomerOptionsData> =>
      calibraApi.customers.list({
        page: 1,
        limit: 100,
      }),
  })
}

export function financeContractServiceOptionsQueryOptions() {
  return queryOptions({
    queryKey: ['finance', 'contract-form', 'services'],
    queryFn: async (): Promise<FinanceContractServiceOptionsData> =>
      calibraApi.services.list({
        page: 1,
        limit: 100,
        isActive: true,
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

export async function prewarmFinanceBillingReadiness(queryClient: QueryClient) {
  await prewarmRouteQueries(queryClient, [
    financeBillingReadinessQueryOptions(),
  ])
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

export function useFinanceDocumentDetailData<TResponse = { data: unknown }>(
  id: string | number,
) {
  return useQuery(financeDocumentDetailQueryOptions<TResponse>(id))
}

export function useFinanceContractDetailData<TResponse = { data: unknown }>(
  id: string | number,
) {
  return useQuery(financeContractDetailQueryOptions<TResponse>(id))
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
