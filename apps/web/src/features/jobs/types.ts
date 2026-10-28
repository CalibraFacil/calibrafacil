import type {
  JobListItem,
  JobStatus,
  JobTechniciansResponse,
  JobsListResponse,
} from '@calibra-facil/contracts'

export type { JobStatus }

/** Statuses the list can be filtered by in the UI (a superseded job is not offered). */
export type JobsListStatus = Exclude<JobStatus, 'SUPERSEDED'>

export const JOBS_LIST_STATUSES = [
  'DRAFT',
  'IN_PROGRESS',
  'REVIEW',
  'GENERATING_PDF',
  'RENDER_FAILED',
  'APPROVED',
  'REJECTED',
  'CANCELED',
] as const satisfies readonly JobsListStatus[]

/** One row of the jobs list (the `@calibra-facil/contracts` response shape). */
export type Job = JobListItem

export type JobsListData = JobsListResponse

export type JobsListQueryInput = {
  organizationId: string
  page: number
  search: string
  statusFilter: JobsListStatus | ''
}

export type JobTechniciansData = JobTechniciansResponse

export type JobTechnician = JobTechniciansData['data'][number]

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
