import type {
  ServiceDetailData as ClientRuntimeServiceDetailData,
  ServicesListData as ClientRuntimeServicesListData,
} from '@calibra-facil/client-runtime'

export const SERVICES_LIST_STATUSES = ['active', 'inactive'] as const

export type ServicesListStatus = (typeof SERVICES_LIST_STATUSES)[number]

export type ServiceListItem = ClientRuntimeServicesListData['data'][number]
export type ServiceDetail = ClientRuntimeServiceDetailData

export type ServicesListData = Omit<ClientRuntimeServicesListData, 'data'> & {
  data: ServiceListItem[]
}

export type ServicesListQueryInput = {
  organizationId: string
  page: number
  limit: number
  search: string
  statusFilter: ServicesListStatus | ''
}

export type ServiceAuditLogRecord = {
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

export type ServiceAuditLogData = {
  data: ServiceAuditLogRecord[]
}

export type PublishedMethodOption = {
  id: number
  name: string
  status: string
  assetTypeId: number | null
  assetTypeName: string | null
}

export type PublishedMethodsData = {
  data: PublishedMethodOption[]
}

export type ServiceAssetTypeOption = {
  id: number
  name: string
  slug: string
}

export type ServiceAssetTypesData = {
  data: ServiceAssetTypeOption[]
}
