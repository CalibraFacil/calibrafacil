import type { CalibrationRequestStatus } from '@calibra-facil/contracts'

// The calibration request DTOs are the contract's (`@calibra-facil/contracts`,
// `endpoints/calibration-requests.ts`).
export type {
  CalibrationRequestDetail,
  CalibrationRequestItem,
  CalibrationRequestListItem,
  CalibrationRequestStatus,
} from '@calibra-facil/contracts'

export type CalibrationRequestsListQueryInput = {
  organizationId: string
  page: number
  limit: number
  search: string
  statusFilter: CalibrationRequestStatus | ''
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
