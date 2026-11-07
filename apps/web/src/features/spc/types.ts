import type {
  SpcChart as ContractSpcChart,
  SpcChartDetail as ContractSpcChartDetail,
} from '@calibra-facil/contracts'
import type { SpcStatus } from '@calibra-facil/schemas/machines'

const SPC_CHART_TYPES = ['i_mr', 'xbar_r', 'cusum', 'ewma'] as const

export type { SpcStatus }
export type SpcChartType = (typeof SPC_CHART_TYPES)[number]
export const SPC_CHART_TYPE_LABELS: Record<SpcChartType, string> = {
  i_mr: 'I-MR (individuais)',
  xbar_r: 'X̄-R (subgrupos)',
  cusum: 'CUSUM',
  ewma: 'EWMA',
}

// The SPC DTOs are the contract's (`@calibra-facil/contracts`,
// `endpoints/spc.ts`); the names below are the views the pages use.
export type SpcChart = ContractSpcChart
export type SpcChartDetail = ContractSpcChartDetail

export type SpcChartListQueryInput = {
  organizationId: string
  page: number
  standardId: number | undefined
  statusFilter: SpcStatus | ''
}

/** Minimal reference-standard option list for the create-chart form. */
type SpcStandardOption = {
  id: number
  name: string
  serialNumber: string
}

export type SpcStandardOptionsData = {
  data: SpcStandardOption[]
}
