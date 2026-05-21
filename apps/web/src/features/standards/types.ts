import type {
  StandardData,
  StandardStatus,
  StandardsListData as ClientRuntimeStandardsListData,
} from '@calibra-facil/client-runtime'

export const STANDARD_STATUSES = [
  'ACTIVE',
  'INACTIVE',
  'OUT_OF_TOLERANCE',
  'SENT_FOR_CALIBRATION',
] as const satisfies readonly StandardStatus[]

export type { StandardStatus }

export type StandardListItem = StandardData
export type StandardDetail = StandardData

export type StandardsListData = Omit<ClientRuntimeStandardsListData, 'data'> & {
  data: StandardListItem[]
}

export type StandardsListQueryInput = {
  organizationId: string
  page: number
  limit: number
  search: string
  statusFilter: StandardStatus | ''
}

export type StandardAuditLogRecord = {
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

export type StandardAuditLogData = {
  data: StandardAuditLogRecord[]
}
