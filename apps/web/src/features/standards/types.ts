import type { StandardRecallNotification } from '@calibra-facil/contracts'
import type {
  StandardData,
  StandardStatus,
  StandardsListData as ClientRuntimeStandardsListData,
} from '@calibra-facil/client-runtime'

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

// The recall and reverse-traceability DTOs are the endpoint definitions' types
// (`@calibra-facil/contracts`, `endpoints/standards.ts`).
export type {
  ImpactedCertificate,
  ImpactedCertificatesData,
  InFlightRecallJob,
  StandardRecall,
  StandardRecallData,
  StandardRecallNotification,
} from '@calibra-facil/contracts'

export type StandardRecallAcknowledgedVia = NonNullable<
  StandardRecallNotification['acknowledgedVia']
>

export type SendStandardRecallRequest = {
  jobIds: number[]
  from?: string
  to?: string
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
