import type { MethodsListData as ClientRuntimeMethodsListData } from '@calibra-facil/client-runtime'
import type { MethodStatus } from '@calibra-facil/schemas/machines'

import type { MethodRecordData } from '@/components/method-builder'
import type { MethodData } from '@/components/method-runtime/types'

export type { MethodStatus }

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
