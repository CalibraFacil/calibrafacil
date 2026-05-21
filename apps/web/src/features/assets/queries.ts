import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query'
import { AssetTypeFieldSchema } from '@calibra-facil/schemas'

import { calibraApi } from '@/utils/api'
import {
  ensureRouteQueries,
  getStableDashboardOrganizationIdForRouteData,
  prewarmRouteQueries,
} from '@/lib/route-data'
import { optionFromUrl, pageFromUrl } from '@/lib/url-search'
import {
  ASSET_STATUSES,
  type AssetAuditLogData,
  type AssetAuditLogRecord,
  type AssetDetail,
  type AssetTypesData,
  type AssetStatus,
  type AssetsListData,
  type AssetsListQueryInput,
  type NewAssetCustomersData,
} from './types'

export const ASSETS_LIST_LIMIT = 20

function statusFromUrl(url?: URL): AssetStatus | '' {
  return optionFromUrl(ASSET_STATUSES, url?.searchParams.get('status'))
}

function customerIdFromUrl(url?: URL) {
  const customerId = Number(url?.searchParams.get('customerId') ?? NaN)
  return Number.isFinite(customerId) && customerId > 0 ? customerId : null
}

export function assetsListQueryInputFromUrl(organizationId: string, url?: URL) {
  return {
    organizationId,
    page: pageFromUrl(url),
    limit: ASSETS_LIST_LIMIT,
    search: url?.searchParams.get('query') ?? '',
    statusFilter: statusFromUrl(url),
    customerId: customerIdFromUrl(url),
  } satisfies AssetsListQueryInput
}

export function assetsListQueryOptions(input: AssetsListQueryInput) {
  return queryOptions({
    queryKey: [
      'assets',
      input.organizationId,
      input.page,
      input.limit,
      input.search,
      input.statusFilter,
      input.customerId,
    ],
    queryFn: (): Promise<AssetsListData> =>
      calibraApi.assets.list({
        page: input.page,
        limit: input.limit,
        query: input.search || undefined,
        status: input.statusFilter || undefined,
        customerId: input.customerId ?? undefined,
      }),
  })
}

export function assetDetailQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['asset', id],
    queryFn: () => calibraApi.assets.get<AssetDetail>(id),
  })
}

export function assetAuditLogQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['asset', id, 'audit-log'],
    queryFn: (): Promise<AssetAuditLogData> =>
      calibraApi.assets.auditLog<AssetAuditLogRecord>(id),
  })
}

export function assetTypesQueryOptions() {
  return queryOptions({
    queryKey: ['asset-types'],
    queryFn: async (): Promise<AssetTypesData> => {
      const result = await calibraApi.assetTypes.list()
      return {
        data: result.data.map((assetType) => ({
          ...assetType,
          slug: assetType.slug ?? String(assetType.id),
          definition: AssetTypeFieldSchema.array().parse(assetType.definition),
        })),
      }
    },
    staleTime: 60_000,
  })
}

export function newAssetCustomersQueryOptions(search = '') {
  return queryOptions({
    queryKey: ['customers', 'search', search],
    queryFn: (): Promise<NewAssetCustomersData> =>
      calibraApi.customers.list({
        page: 1,
        limit: 50,
        query: search || undefined,
      }),
    staleTime: 30_000,
  })
}

export async function getAssetsIndexEssentialQueries(url?: URL) {
  const organizationId = await getStableDashboardOrganizationIdForRouteData()
  if (!organizationId) return []

  return [
    assetsListQueryOptions(assetsListQueryInputFromUrl(organizationId, url)),
  ]
}

export async function loadAssetsIndexData(queryClient: QueryClient, url?: URL) {
  await ensureRouteQueries(
    queryClient,
    await getAssetsIndexEssentialQueries(url),
  )
}

export async function prewarmAssetsIndex(queryClient: QueryClient, url?: URL) {
  await prewarmRouteQueries(
    queryClient,
    await getAssetsIndexEssentialQueries(url),
  )
}

export async function loadAssetHeaderData(
  queryClient: QueryClient,
  id: string,
) {
  await ensureRouteQueries(queryClient, [assetDetailQueryOptions(id)])
}

export async function loadAssetDetailData(
  queryClient: QueryClient,
  id: string,
) {
  await ensureRouteQueries(queryClient, [
    assetDetailQueryOptions(id),
    assetAuditLogQueryOptions(id),
  ])
}

export async function prewarmAssetDetail(queryClient: QueryClient, id: string) {
  await prewarmRouteQueries(queryClient, [
    assetDetailQueryOptions(id),
    assetAuditLogQueryOptions(id),
  ])
}

export async function loadAssetEditData(queryClient: QueryClient, id: string) {
  await ensureRouteQueries(queryClient, [assetDetailQueryOptions(id)])
}

export async function prewarmAssetEdit(queryClient: QueryClient, id: string) {
  await prewarmRouteQueries(queryClient, [assetDetailQueryOptions(id)])
}

export async function loadNewAssetData(queryClient: QueryClient) {
  await ensureRouteQueries(queryClient, [
    newAssetCustomersQueryOptions(),
    assetTypesQueryOptions(),
  ])
}

export async function prewarmNewAsset(queryClient: QueryClient) {
  await prewarmRouteQueries(queryClient, [
    newAssetCustomersQueryOptions(),
    assetTypesQueryOptions(),
  ])
}

export function useAssetsListData({
  activeOrganizationId,
  enabled,
  page,
  limit,
  search,
  statusFilter,
  customerId,
}: {
  activeOrganizationId: string | null
  enabled: boolean
  page: number
  limit: number
  search: string
  statusFilter: AssetStatus | ''
  customerId: number | null
}) {
  return useQuery({
    ...assetsListQueryOptions({
      organizationId: activeOrganizationId ?? 'no-org',
      page,
      limit,
      search,
      statusFilter,
      customerId,
    }),
    enabled: Boolean(activeOrganizationId) && enabled,
  })
}

export function useAssetDetailData(id: string) {
  return useQuery(assetDetailQueryOptions(id))
}

export function useAssetAuditLogData(id: string) {
  return useQuery(assetAuditLogQueryOptions(id))
}

export function useAssetTypesData() {
  return useQuery(assetTypesQueryOptions())
}

export function useNewAssetCustomersData(search = '') {
  return useQuery(newAssetCustomersQueryOptions(search))
}
