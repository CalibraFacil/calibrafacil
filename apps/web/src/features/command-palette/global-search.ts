import { queryOptions, useQuery } from '@tanstack/react-query'

import { calibraApi } from '@/utils/api'

export type SearchMode = 'assets' | 'clients' | 'standards' | 'jobs' | null

export type AssetSearchResult = {
  id: number
  tag: string
  serialNumber: string
  assetTypeName: string
  customerName: string
  customerTaxId: string | null
}

export type ClientSearchResult = {
  id: number
  name: string
  email: string | null
  taxId: string | null
}

export type StandardSearchResult = {
  id: number
  name: string
  serialNumber: string
  manufacturer: string | null
}

export type JobSearchResult = {
  id: number
  jobId: string
  status: string
}

export const SEARCH_DEBOUNCE_MS = 150
export const SEARCH_MIN_LENGTH = 2
export const SEARCH_RESULT_LIMIT = 5
const SEARCH_STALE_TIME_MS = 30_000

export function getSearchModeFromPage(activePage: string): SearchMode {
  switch (activePage) {
    case 'search-assets':
      return 'assets'
    case 'search-clients':
      return 'clients'
    case 'search-standards':
      return 'standards'
    case 'search-jobs':
      return 'jobs'
    default:
      return null
  }
}

export function commandSearchAssetsQueryOptions(query: string) {
  return queryOptions({
    queryKey: ['command-search', 'assets', query],
    queryFn: async () => {
      if (query.length < SEARCH_MIN_LENGTH) return []
      const result = await calibraApi.assets.list({
        page: 1,
        limit: SEARCH_RESULT_LIMIT,
        query,
      })

      return result.data.map((asset) => ({
        id: asset.id,
        tag: asset.tag,
        serialNumber: asset.serialNumber,
        assetTypeName: asset.assetTypeName,
        customerName: asset.customerName,
        customerTaxId: asset.customerTaxId ?? null,
      })) satisfies AssetSearchResult[]
    },
    staleTime: SEARCH_STALE_TIME_MS,
  })
}

export function commandSearchClientsQueryOptions(query: string) {
  return queryOptions({
    queryKey: ['command-search', 'clients', query],
    queryFn: async () => {
      if (query.length < SEARCH_MIN_LENGTH) return []
      const result = await calibraApi.customers.list({
        page: 1,
        limit: SEARCH_RESULT_LIMIT,
        query,
      })

      return result.data.map((customer) => ({
        id: customer.id,
        name: customer.name,
        email: customer.email,
        taxId: customer.taxId,
      })) satisfies ClientSearchResult[]
    },
    staleTime: SEARCH_STALE_TIME_MS,
  })
}

export function commandSearchStandardsQueryOptions(query: string) {
  return queryOptions({
    queryKey: ['command-search', 'standards', query],
    queryFn: async () => {
      if (query.length < SEARCH_MIN_LENGTH) return []
      const result = await calibraApi.standards.list({
        page: 1,
        limit: SEARCH_RESULT_LIMIT,
        query,
      })

      return result.data.map((standard) => ({
        id: standard.id,
        name: standard.name,
        serialNumber: standard.serialNumber,
        manufacturer: standard.manufacturer,
      })) satisfies StandardSearchResult[]
    },
    staleTime: SEARCH_STALE_TIME_MS,
  })
}

export function commandSearchJobsQueryOptions(query: string) {
  return queryOptions({
    queryKey: ['command-search', 'jobs', query],
    queryFn: async () => {
      if (query.length < SEARCH_MIN_LENGTH) return []
      const result = await calibraApi.jobs.list({
        page: 1,
        limit: SEARCH_RESULT_LIMIT,
        query,
      })

      return result.data.map((job) => ({
        id: job.id,
        jobId: job.jobId,
        status: job.status,
      })) satisfies JobSearchResult[]
    },
    staleTime: SEARCH_STALE_TIME_MS,
  })
}

export function useCommandSearchAssetsData({
  enabled,
  query,
}: {
  enabled: boolean
  query: string
}) {
  return useQuery({
    ...commandSearchAssetsQueryOptions(query),
    enabled,
    placeholderData: (previousData) => previousData,
  })
}

export function useCommandSearchClientsData({
  enabled,
  query,
}: {
  enabled: boolean
  query: string
}) {
  return useQuery({
    ...commandSearchClientsQueryOptions(query),
    enabled,
    placeholderData: (previousData) => previousData,
  })
}

export function useCommandSearchStandardsData({
  enabled,
  query,
}: {
  enabled: boolean
  query: string
}) {
  return useQuery({
    ...commandSearchStandardsQueryOptions(query),
    enabled,
    placeholderData: (previousData) => previousData,
  })
}

export function useCommandSearchJobsData({
  enabled,
  query,
}: {
  enabled: boolean
  query: string
}) {
  return useQuery({
    ...commandSearchJobsQueryOptions(query),
    enabled,
    placeholderData: (previousData) => previousData,
  })
}
