import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query'
import type { AssetDetail as ContractAssetDetail } from '@calibra-facil/contracts'
import { AssetTypeFieldSchema } from '@calibra-facil/schemas'
import { REGULATED_INTERVAL_KINDS } from '@calibra-facil/shared'
import { isMassUnit } from '@calibra-facil/shared/mass-units'
import { isRecord } from '@calibra-facil/shared/record'
import { z } from 'zod'

import { calibraApi, getApiBaseURL } from '@/utils/api'
import { keepPreviousDataInScope } from '@calibra-facil/shared/query-scope'
import {
  readStoredRegulatedInterval,
  type LegalMetrologyRegulationCatalogEntry,
} from './forms'
import {
  ensureRouteQueries,
  getStableDashboardOrganizationIdForRouteData,
  routeData,
} from '@/lib/route-data'
import { optionFromUrl, pageFromUrl } from '@/lib/url-search'
import { ASSET_STATUS } from '@calibra-facil/schemas/machines'
import {
  type AssetAuditLogData,
  type AssetAuditLogRecord,
  type AssetDetail,
  type AssetTypesData,
  type AssetStatus,
  type AssetsListData,
  type AssetsListQueryInput,
} from './types'
import { assetKeys } from '@/features/assets/keys'
import { customerPickerQueryOptions } from '@/features/customers/queries'

export const ASSETS_LIST_LIMIT = 20

function statusFromUrl(url?: URL): AssetStatus | '' {
  return optionFromUrl(ASSET_STATUS.states, url?.searchParams.get('status'))
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
    queryKey: assetKeys.list(input),
    queryFn: (): Promise<AssetsListData> =>
      calibraApi.assets.list({
        query: {
          page: input.page,
          limit: input.limit,
          query: input.search || undefined,
          status: input.statusFilter || undefined,
          customerId: input.customerId ?? undefined,
        },
      }),
    placeholderData: keepPreviousDataInScope(
      assetKeys.listScope(input.organizationId),
    ),
  })
}

/**
 * The detail as the pages read it: the untyped columns (the type's field
 * definitions, the base unit, the regulated interval) are narrowed here, once.
 */
function toAssetDetail(detail: ContractAssetDetail): AssetDetail {
  const definition = AssetTypeFieldSchema.array().safeParse(
    detail.assetTypeDefinition,
  )
  return {
    ...detail,
    assetTypeDefinition: definition.success ? definition.data : null,
    baseMeasurementUnit: isMassUnit(detail.baseMeasurementUnit)
      ? detail.baseMeasurementUnit
      : null,
    regulatedInterval: readStoredRegulatedInterval(detail.regulatedInterval),
  }
}

export function assetDetailQueryOptions(id: string) {
  return queryOptions({
    queryKey: assetKeys.detail(id),
    queryFn: async (): Promise<AssetDetail> =>
      toAssetDetail(await calibraApi.assets.get({ params: { id } })),
  })
}

export function assetAuditLogQueryOptions(id: string) {
  return queryOptions({
    queryKey: assetKeys.auditLog(id),
    queryFn: async (): Promise<AssetAuditLogData> => {
      const log = await calibraApi.assets.auditLog({ params: { id } })
      return {
        data: log.data.map(
          (entry): AssetAuditLogRecord => ({
            ...entry,
            // The column is untyped JSON; the timeline reads it as a record.
            changes: isRecord(entry.changes) ? entry.changes : null,
          }),
        ),
      }
    },
  })
}

export function assetTypesQueryOptions() {
  return queryOptions({
    queryKey: assetKeys.types,
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

// The GLOBAL legal-metrology regulation catalog. Fetched with a raw
// same-origin request (NOT calibraApi) so the client-runtime data-policy snapshot is left
// untouched. Suggestion-only reference data — if the fetch fails (e.g. offline desktop) the
// regime form simply offers no catalog options and stays fully editable by hand.
const LegalMetrologyRegulationEntrySchema = z.object({
  id: z.number(),
  category: z.string(),
  kind: z.enum(REGULATED_INTERVAL_KINDS),
  valueMonths: z.number().nullable(),
  byTechnology: z.record(z.string(), z.number()).nullable(),
  anchor: z.string().nullable(),
  operationalizedByDelegate: z.boolean(),
  regulationReference: z.string(),
  provenance: z.enum(['primary', 'secondary']),
  note: z.string().nullable(),
}) satisfies z.ZodType<LegalMetrologyRegulationCatalogEntry>

const LegalMetrologyRegulationListSchema = z.object({
  data: z.array(LegalMetrologyRegulationEntrySchema),
})

function legalMetrologyRegulationsQueryOptions() {
  return queryOptions({
    queryKey: assetKeys.legalMetrologyRegulations,
    queryFn: async (): Promise<LegalMetrologyRegulationCatalogEntry[]> => {
      const response = await fetch(
        `${getApiBaseURL()}/api/legal-metrology-regulations`,
        { credentials: 'include' },
      )
      if (!response.ok) {
        throw new Error(
          `Falha ao carregar o catálogo de regulamentos (${response.status})`,
        )
      }
      const json: unknown = await response.json()
      return LegalMetrologyRegulationListSchema.parse(json).data
    },
    staleTime: 5 * 60_000,
  })
}

export function useLegalMetrologyRegulationsData(enabled = true) {
  return useQuery({ ...legalMetrologyRegulationsQueryOptions(), enabled })
}

export function newAssetCustomersQueryOptions(search = '') {
  return customerPickerQueryOptions(search)
}

async function getAssetsIndexEssentialQueries(url?: URL) {
  const organizationId = await getStableDashboardOrganizationIdForRouteData()
  if (!organizationId) return []

  return [
    assetsListQueryOptions(assetsListQueryInputFromUrl(organizationId, url)),
  ]
}

const assetsIndexRouteData = routeData((url?: URL) =>
  getAssetsIndexEssentialQueries(url),
)
export const loadAssetsIndexData = assetsIndexRouteData.load
export const prewarmAssetsIndex = assetsIndexRouteData.prewarm

export async function loadAssetHeaderData(
  queryClient: QueryClient,
  id: string,
) {
  await ensureRouteQueries(queryClient, [assetDetailQueryOptions(id)])
}

const assetDetailRouteData = routeData((id: string) => [
  assetDetailQueryOptions(id),
  assetAuditLogQueryOptions(id),
])
export const loadAssetDetailData = assetDetailRouteData.load
export const prewarmAssetDetail = assetDetailRouteData.prewarm

const assetEditRouteData = routeData((id: string) => [
  assetDetailQueryOptions(id),
])
export const loadAssetEditData = assetEditRouteData.load
export const prewarmAssetEdit = assetEditRouteData.prewarm

const newAssetRouteData = routeData(() => [
  newAssetCustomersQueryOptions(),
  assetTypesQueryOptions(),
])
export const loadNewAssetData = newAssetRouteData.load
export const prewarmNewAsset = newAssetRouteData.prewarm

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
