import type { MethodDetailData as ClientRuntimeMethodDetailData } from '@calibra-facil/client-runtime'

import type { MethodRecordData } from '@/components/method-builder'
import type { MethodData } from '@/components/method-runtime/types'

type ClientRuntimeMethodsListData = {
  data: Array<ClientRuntimeMethodDetailData>
  pagination?: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

export const METHOD_STATUSES = [
  'DRAFT',
  'PENDING_APPROVAL',
  'TECHNICAL_REVIEWED',
  'PUBLISHED',
  'ARCHIVED',
] as const

export type MethodStatus = (typeof METHOD_STATUSES)[number]

export type MethodListItem = Omit<
  ClientRuntimeMethodsListData['data'][number],
  'status'
> & {
  status: MethodStatus
}

export type MethodsListData = Omit<ClientRuntimeMethodsListData, 'data'> & {
  data: MethodListItem[]
}

export type MethodsListQueryInput = {
  organizationId: string
  page: number
  limit: number
  search: string
  statusFilter: MethodStatus | ''
}

export type MethodDetail = MethodData & {
  assetTypeName?: string | null
  createdByName?: string
  createdAt: string
  technicalReviewedByName?: string | null
  approvedByName?: string | null
  publishedAt?: string | null
  archivedAt?: string | null
}

export type MethodEditData = MethodRecordData

export type MethodAuditLogRecord = {
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

export type MethodAuditLogData = {
  data: Array<MethodAuditLogRecord>
}
