import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query'

import { calibraApi } from '@/utils/api'
import {
  ensureRouteQueries,
  getStableDashboardOrganizationIdForRouteData,
  prewarmRouteQueries,
} from '@/lib/route-data'
import { optionFromUrl, pageFromUrl } from '@/lib/url-search'
import {
  MATERIALS_LIST_STATUSES,
  type MaterialDetail,
  type MaterialsListData,
  type MaterialsListQueryInput,
  type MaterialsListStatus,
} from './types'

export const MATERIALS_LIST_LIMIT = 20

function statusFromUrl(url?: URL): MaterialsListStatus | '' {
  return optionFromUrl(MATERIALS_LIST_STATUSES, url?.searchParams.get('status'))
}

export function materialsListQueryInputFromUrl(
  organizationId: string,
  url?: URL,
) {
  return {
    organizationId,
    page: pageFromUrl(url),
    limit: MATERIALS_LIST_LIMIT,
    search: url?.searchParams.get('query') ?? '',
    statusFilter: statusFromUrl(url),
  } satisfies MaterialsListQueryInput
}

export function materialsListQueryOptions(input: MaterialsListQueryInput) {
  return queryOptions({
    queryKey: [
      'materials',
      input.organizationId,
      input.page,
      input.search,
      input.statusFilter,
    ],
    queryFn: (): Promise<MaterialsListData> =>
      calibraApi.materials.list({
        page: input.page,
        limit: input.limit,
        query: input.search || undefined,
        isActive:
          input.statusFilter === 'active'
            ? true
            : input.statusFilter === 'inactive'
              ? false
              : undefined,
      }),
  })
}

export function materialDetailQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['materials', id],
    queryFn: (): Promise<MaterialDetail> => calibraApi.materials.get(id),
  })
}

export async function getMaterialsIndexEssentialQueries(url?: URL) {
  const organizationId = await getStableDashboardOrganizationIdForRouteData()
  if (!organizationId) return []

  return [
    materialsListQueryOptions(
      materialsListQueryInputFromUrl(organizationId, url),
    ),
  ]
}

export async function loadMaterialsIndexData(
  queryClient: QueryClient,
  url?: URL,
) {
  await ensureRouteQueries(
    queryClient,
    await getMaterialsIndexEssentialQueries(url),
  )
}

export async function prewarmMaterialsIndex(
  queryClient: QueryClient,
  url?: URL,
) {
  await prewarmRouteQueries(
    queryClient,
    await getMaterialsIndexEssentialQueries(url),
  )
}

export async function loadMaterialEditData(
  queryClient: QueryClient,
  id: string,
) {
  await ensureRouteQueries(queryClient, [materialDetailQueryOptions(id)])
}

export async function prewarmMaterialEdit(
  queryClient: QueryClient,
  id: string,
) {
  await prewarmRouteQueries(queryClient, [materialDetailQueryOptions(id)])
}

export function useMaterialsListData({
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
  statusFilter: MaterialsListStatus | ''
}) {
  return useQuery({
    ...materialsListQueryOptions({
      organizationId: activeOrganizationId ?? 'no-org',
      page,
      limit,
      search,
      statusFilter,
    }),
    enabled: Boolean(activeOrganizationId) && enabled,
  })
}

export function useMaterialDetailData(id: string) {
  return useQuery(materialDetailQueryOptions(id))
}
