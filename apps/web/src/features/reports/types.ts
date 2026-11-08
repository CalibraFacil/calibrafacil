import type { ReportPeriod } from '@calibra-facil/contracts'

// The report DTOs are the contract's (`@calibra-facil/contracts`,
// `endpoints/reports.ts`); only the cache-key input is web-local.
export type {
  ComparisonResponse,
  ReportPeriod,
  ReportUnitOption,
} from '@calibra-facil/contracts'

export type ReportsQueryInput = {
  organizationId: string | null | undefined
  period: ReportPeriod
  unitIds: string | undefined
}
