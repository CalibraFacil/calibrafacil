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

export type ImpactedCertificate = {
  jobId: number
  certificateNumber: string
  status: string
  approvedAt: string | null
  performedAt: string | null
  customer: {
    id: number
    name: string
    email: string | null
  }
  supersededByJobId: number | null
  supersededByCertificateNumber: string | null
  alreadyNotified: boolean
}

export type ImpactedCertificatesData = {
  data: ImpactedCertificate[]
  window: { from: string; to: string }
}

export type StandardRecallStatus = 'DRAFT' | 'SENT'

export type StandardRecallNotificationStatus =
  | 'PENDING'
  | 'GENERATED'
  | 'SENT'
  | 'ACKNOWLEDGED'

export type StandardRecallAcknowledgedVia =
  | 'email_link'
  | 'portal_link'
  | 'manual'

export type StandardRecallNotification = {
  id: number
  jobId: number
  certificateNumber: string
  recipientName: string | null
  recipientEmail: string | null
  status: StandardRecallNotificationStatus
  sentAt: string | null
  acknowledgedAt: string | null
  acknowledgedVia: StandardRecallAcknowledgedVia | null
  bounced: boolean
}

export type StandardRecall = {
  id: number
  standardId: number
  ncId: number
  ncNumber: string
  status: StandardRecallStatus
  fromDate: string | null
  toDate: string | null
  approvedBy: string | null
  approvedAt: string | null
  createdAt: string
  notifications: StandardRecallNotification[]
  counts: {
    total: number
    sent: number
    acknowledged: number
    bounced: number
    missingEmail: number
  }
}

export type StandardRecallData = { data: StandardRecall | null }

export type SendStandardRecallRequest = {
  jobIds: number[]
  from?: string
  to?: string
}

export type SendStandardRecallResult = {
  message: string
  data: { recallId: number; created: number; skipped: number }
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
