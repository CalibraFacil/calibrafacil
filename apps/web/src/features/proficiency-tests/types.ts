import type {
  PtPlanItem as ContractPtPlanItem,
  PtResultPoint as ContractPtResultPoint,
  PtRound as ContractPtRound,
} from '@calibra-facil/contracts'
import type { PtOverallStatus } from '@calibra-facil/schemas/machines'

export const PT_ACTIVITY_TYPES = [
  'proficiency_test',
  'interlab_comparison',
] as const

const SCORE_TYPES = ['en', 'z', 'z_prime', 'zeta'] as const

type PtStatus = PtOverallStatus
export type PtActivityType = (typeof PT_ACTIVITY_TYPES)[number]
export type PtScoreType = (typeof SCORE_TYPES)[number]

export const PT_ACTIVITY_TYPE_LABELS: Record<PtActivityType, string> = {
  proficiency_test: 'Ensaio de proficiência',
  interlab_comparison: 'Comparação interlaboratorial',
}

export const SCORE_TYPE_LABELS: Record<PtScoreType, string> = {
  en: 'En',
  z: 'z',
  z_prime: 'z′',
  zeta: 'ζ',
}

// The proficiency-test DTOs are the contract's (`@calibra-facil/contracts`,
// `endpoints/proficiency-tests.ts`); the names below are the views the pages use.
export type PtRound = ContractPtRound
export type PtResultPoint = ContractPtResultPoint
export type PtPlanItem = ContractPtPlanItem

export type PtListQueryInput = {
  organizationId: string
  page: number
  search: string
  statusFilter: PtStatus | ''
  activityTypeFilter: PtActivityType | ''
}

/** Minimal reference-standard option list for the create-round form. */
type PtStandardOption = {
  id: number
  name: string
  serialNumber: string
}

export type PtStandardOptionsData = {
  data: PtStandardOption[]
}
