import type {
  AssetDetailData as ClientRuntimeAssetDetailData,
  AssetTypesListData as ClientRuntimeAssetTypesListData,
  AssetStatus,
  AssetTypeListItem as ClientRuntimeAssetTypeListItem,
  AssetsListData as ClientRuntimeAssetsListData,
} from '@calibra-facil/client-runtime'
import type { MassUnit } from '@calibra-facil/shared'

import type { SpecFieldDefinition } from '@/components/dynamic-specs-form'

export const ASSET_STATUSES = [
  'ACTIVE',
  'INACTIVE',
  'MAINTENANCE',
  'SCRAPPED',
] as const satisfies readonly AssetStatus[]

export type { AssetStatus }

export type AssetListItem = ClientRuntimeAssetsListData['data'][number] & {
  syncState?: string | null
}

export type AssetsListData = Omit<ClientRuntimeAssetsListData, 'data'> & {
  data: AssetListItem[]
}

export type AssetsListQueryInput = {
  organizationId: string
  page: number
  limit: number
  search: string
  statusFilter: AssetStatus | ''
  customerId: number | null
}

export type AssetDetail = Omit<
  ClientRuntimeAssetDetailData,
  'assetTypeDefinition' | 'baseMeasurementUnit'
> & {
  assetTypeDefinition?: SpecFieldDefinition[] | null
  baseMeasurementUnit?: MassUnit | null
}

export type AssetType = Omit<ClientRuntimeAssetTypeListItem, 'definition'> & {
  slug: string
  definition: SpecFieldDefinition[]
}

export type AssetTypesData = Omit<ClientRuntimeAssetTypesListData, 'data'> & {
  data: AssetType[]
}

export type NewAssetCustomersData = {
  data: Array<{
    id: number
    name: string
    taxId?: string | null
  }>
}

export type AssetAuditLogRecord = {
  id: number
  action: string
  changes?: Record<string, unknown> | null
  performedAt: string
  performedBy?: string | null
  performerName?: string | null
  performedByName?: string | null
  ipAddress?: string | null
  reason?: string | null
}

export type AssetAuditLogData = {
  data: Array<AssetAuditLogRecord>
}
