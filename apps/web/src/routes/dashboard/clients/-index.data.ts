import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query'

import { api } from '@/utils/api'
import {
  ensureRouteQueries,
  getStableDashboardOrganizationIdForRouteData,
  prewarmRouteQueries,
} from '@/lib/route-data'
import type { Client } from './-components/columns'

export type ClientsListData = {
  data: Client[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

export type ClientsListQueryInput = {
  organizationId: string
  page: number
  limit: number
  search: string
}

export function clientsListQueryOptions(input: ClientsListQueryInput) {
  return queryOptions({
    queryKey: [
      'customers',
      input.organizationId,
      input.page,
      input.limit,
      input.search,
    ],
    queryFn: async () => {
      const res = await api.api.customers.$get({
        query: {
          page: String(input.page),
          limit: String(input.limit),
          query: input.search || undefined,
        },
      })

      if (!res.ok) {
        throw new Error('Falha ao carregar clientes')
      }

      return res.json() as Promise<ClientsListData>
    },
  })
}

export async function getClientsIndexEssentialQueries() {
  const organizationId = await getStableDashboardOrganizationIdForRouteData()
  if (!organizationId) return []

  return [
    clientsListQueryOptions({
      organizationId,
      page: 1,
      limit: 20,
      search: '',
    }),
  ]
}

export async function loadClientsIndexData(queryClient: QueryClient) {
  await ensureRouteQueries(queryClient, await getClientsIndexEssentialQueries())
}

export async function prewarmClientsIndex(queryClient: QueryClient) {
  await prewarmRouteQueries(
    queryClient,
    await getClientsIndexEssentialQueries(),
  )
}

export function useClientsListData({
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
    ...clientsListQueryOptions({
      organizationId: activeOrganizationId ?? 'no-org',
      page,
      limit,
      search,
    }),
    enabled: Boolean(activeOrganizationId) && enabled,
  })
}
