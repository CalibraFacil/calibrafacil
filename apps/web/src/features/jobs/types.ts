export type JobStatus =
  | 'DRAFT'
  | 'IN_PROGRESS'
  | 'REVIEW'
  | 'GENERATING_PDF'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELED'
  | 'SUPERSEDED'

export type JobsListStatus = Exclude<JobStatus, 'SUPERSEDED'>

export const JOBS_LIST_STATUSES = [
  'DRAFT',
  'IN_PROGRESS',
  'REVIEW',
  'GENERATING_PDF',
  'APPROVED',
  'REJECTED',
  'CANCELED',
] as const satisfies readonly JobsListStatus[]

export interface Job {
  id: number
  jobId: string
  status: JobStatus
  dueDate: string | null
  performedAt?: string | null
  createdAt: string
  updatedAt?: string
  approvedAt?: string | null
  customerId?: number
  customerName: string | null
  assetId?: number
  assetName: string | null
  assetTag?: string | null
  serviceId?: number
  serviceName: string | null
  technicianId?: string | null
  technicianName: string | null
  methodName?: string | null
  methodVersion?: number | null
  isOverdue: boolean | null
  daysUntilDue?: number | null
  financialStatus?: 'UNBILLED' | 'DRAFT' | 'ISSUED' | 'PAID' | 'OVERDUE'
  invoiceDocumentNumber?: string | null
  invoiceEligibility?: boolean
  overdueBalanceFlag?: boolean
  syncState?: string | null
}

export type JobsListData = {
  data: Job[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

export type JobsListQueryInput = {
  organizationId: string
  page: number
  search: string
  statusFilter: JobsListStatus | ''
}

export type JobTechnician = {
  id: string
  name: string
  email: string
  role: string
}

export type JobTechniciansData = {
  data: Array<JobTechnician>
}

export type NewJobCustomer = {
  id: number
  name: string
  taxId?: string | null
  compliance?: {
    qualificationStatus?: string | null
  } | null
}

export type NewJobCustomersData = {
  data: Array<NewJobCustomer>
}

export type NewJobAsset = {
  id: number
  name: string
  tag: string
  serialNumber?: string | null
  assetTypeId?: number | null
  assetTypeName?: string | null
}

export type NewJobAssetsData = {
  data: Array<NewJobAsset>
}

export type NewJobService = {
  id: number
  name: string
  description?: string | null
  methodName?: string | null
  price: number | null
  currency: string
  tat: number | null
}

export type NewJobServicesData = {
  data: Array<NewJobService>
}

export type ReferenceStandardsData<TStandard = unknown> = {
  data: Array<TStandard>
}

export type EffectiveEnvironmentalLimitsData<TLimits = unknown> = {
  limits: TLimits | null
  source: string | null
}
