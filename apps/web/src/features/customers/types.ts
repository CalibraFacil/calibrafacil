import type { JobStatus } from '@calibra-facil/schemas'
import type { AssetStatus } from '@calibra-facil/schemas/machines'
import type { CustomersListData as ClientRuntimeCustomersListData } from '@calibra-facil/client-runtime'
import type {
  CustomerAuditLogEntry,
  CustomerDetail as ContractCustomerDetail,
} from '@calibra-facil/contracts'
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

export type CustomerFinancialTimelineResponse = {
  data: CustomerFinancialTimeline
}

// The customer DTOs are the contract's (`@calibra-facil/contracts`,
// `endpoints/customers.ts`); the names below are the views the pages use.
export type CustomerDetail = ContractCustomerDetail
export type CustomerCompliance = NonNullable<CustomerDetail['compliance']>

type CustomerAssetStatus = AssetStatus

type CustomerAsset = {
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

export type CustomerJob = {
  id: number
  jobId: string
  status: JobStatus
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
