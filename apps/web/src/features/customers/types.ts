import type { CustomersListData as ClientRuntimeCustomersListData } from '@calibra-facil/client-runtime'
import type { CustomerFinancialTimeline } from '@calibra-facil/shared'

export type CustomerListItem =
  ClientRuntimeCustomersListData['data'][number] & {
    syncState?: string | null
  }

export type CustomersListData = Omit<ClientRuntimeCustomersListData, 'data'> & {
  data: CustomerListItem[]
}

export type CustomersListQueryInput = {
  organizationId: string
  page: number
  limit: number
  search: string
}

export type CustomerAddress = {
  cep?: string
  number?: string
  street?: string
  complement?: string
  neighbourhood?: string
  city?: string
  state?: string
}

export type CustomerFinancialSummary = {
  openDocumentsCount: number
  overdueDocumentsCount: number
  openBalanceCents: number
  overdueBalanceCents: number
  overdueBalanceFlag: boolean
}

export type CustomerFinancialTimelineResponse = {
  data: CustomerFinancialTimeline
}

export type CustomerCompliance = {
  qualificationStatus?: 'pending' | 'qualified' | 'suspended' | 'expired'
  qualificationDate?: string
  qualificationExpiresAt?: string
  contractAgreementId?: number
  contractNumber?: string
  contractSignedAt?: string
  contractExpiresAt?: string
  qualityRequirementsAcknowledged?: boolean
  qualityRequirementsAcknowledgedAt?: string
  notes?: string
}

export type ActiveCommercialAgreement = {
  id: number
  title: string
  agreementCode: string | null
  effectiveFrom: string
  effectiveTo: string | null
  currency: string
  defaultPaymentTermDays: number
}

export type CustomerDetail = {
  id: number
  name?: string
  taxId?: string
  email?: string
  phone?: string
  address?: CustomerAddress
  financialSummary?: CustomerFinancialSummary
  compliance?: CustomerCompliance
  activeCommercialAgreement?: ActiveCommercialAgreement | null
  groupId?: number | null
  group?: { id: number; name: string } | null
}

export type CustomerAssetStatus =
  | 'ACTIVE'
  | 'INACTIVE'
  | 'MAINTENANCE'
  | 'SCRAPPED'

export type CustomerAsset = {
  id: number
  name: string
  tag: string
  serialNumber: string | null
  manufacturer: string | null
  status: CustomerAssetStatus
  nextCalibrationDate?: string | Date | null
  [key: string]: unknown
}

export type CustomerAssetsData = {
  data: CustomerAsset[]
  pagination?: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

export type CustomerJobStatus =
  | 'DRAFT'
  | 'IN_PROGRESS'
  | 'REVIEW'
  | 'GENERATING_PDF'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELED'
  | 'SUPERSEDED'

export type CustomerJob = {
  id: number
  jobId: string
  status: CustomerJobStatus
  performedAt?: string | null
  approvedAt?: string | null
  createdAt: string
  assetName: string | null
  assetTag?: string | null
  serviceName: string | null
  technicianName: string | null
  methodName?: string | null
  methodVersion?: number | null
}

export type CustomerJobsData = {
  data: CustomerJob[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

export type CustomerAuditLogEntry = {
  id: number
  action: string
  changes: unknown
  performedAt: string
  reason: string | null
  performedByName: string
  performedByEmail: string
}

export type CustomerAuditLogData = {
  data: CustomerAuditLogEntry[]
  pagination?: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

export type PortalMember = {
  id: string
  userId: string
  role: string
  createdAt: string
  userName: string
  userEmail: string
  userImage: string | null
}

export type PortalInvitation = {
  id: string
  email: string
  role: string | null
  status: string
  expiresAt: string
  createdAt: string
  inviterName: string
  inviterEmail: string
}
