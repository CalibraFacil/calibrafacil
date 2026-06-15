export const CALIBRATION_REQUEST_STATUSES = [
  'PENDING',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'CONVERTED',
] as const

export type CalibrationRequestStatus =
  (typeof CALIBRATION_REQUEST_STATUSES)[number]

export type CalibrationRequestListItem = {
  id: number
  status: CalibrationRequestStatus
  observations: string | null
  requestedDueDate: string | null
  submittedAt: string
  reviewedAt: string | null
  approvedAt: string | null
  rejectedAt: string | null
  convertedAt: string | null
  customerId: number
  customerName: string
  submittedByName: string | null
  itemCount: number
}

export type CalibrationRequestsListData = {
  data: Array<CalibrationRequestListItem>
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

export type CalibrationRequestsListQueryInput = {
  organizationId: string
  page: number
  limit: number
  search: string
  statusFilter: CalibrationRequestStatus | ''
}

export type CalibrationRequestItem = {
  id: number
  assetId: number
  assetName: string
  assetTag: string
  assetSerialNumber: string
  assetManufacturer: string | null
  assetModel: string | null
  assetTypeId: number | null
  assetTypeName: string | null
  convertedJobId: number | null
  convertedJobCode: string | null
  convertedJobStatus: string | null
  convertedServiceName: string | null
}

export type CalibrationRequestDetail = {
  id: number
  status: CalibrationRequestStatus
  observations: string | null
  internalNotes: string | null
  requestedDueDate: string | null
  deliveryMethod: 'dropoff' | 'carrier' | 'onsite'
  onsiteAddress: {
    cep?: string
    number?: string
    street?: string
    complement?: string
    neighbourhood?: string
    city?: string
    state?: string
  } | null
  preferredVisitDate: string | null
  submittedAt: string
  reviewedAt: string | null
  approvedAt: string | null
  rejectedAt: string | null
  rejectionReason: string | null
  convertedAt: string | null
  customerId: number
  customerName: string
  submittedBy: string
  submittedByName: string | null
  reviewedBy: string | null
  reviewedByName: string | null
  approvedBy: string | null
  approvedByName: string | null
  rejectedBy: string | null
  rejectedByName: string | null
  convertedBy: string | null
  convertedByName: string | null
  items: Array<CalibrationRequestItem>
}

export type RequestConversionService = {
  id: number
  name: string
  assetTypeId: number | null
  methodId: number | null
  methodStatus: string | null
}

export type RequestTechnician = {
  id: string
  name: string
}
