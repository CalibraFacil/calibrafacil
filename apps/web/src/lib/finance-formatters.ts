import { formatCalendarDate, formatMoney } from '@calibra-facil/shared/format'

export type BillingMode = 'single' | 'consolidated'

export const FINANCE_CURRENCY = 'BRL'

export function formatFinanceMoney(value: number, currency = 'BRL') {
  return formatMoney(value ?? 0, currency)
}

export function parseFinanceCurrencyInputToCents(value: string) {
  const normalized = value.replace(/\s/g, '').replace(',', '.')
  const parsed = Number.parseFloat(normalized)

  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0
  }

  return Math.round(parsed * 100)
}

export function getBillingModeLabel(mode: BillingMode) {
  return mode === 'single' ? 'Por OS' : 'Consolidada'
}

/**
 * Finance dates are mostly date-only (a due day typed in a date field and
 * stored at UTC midnight) next to real moments (exported, completed): both
 * show on the laboratory's day, a UTC-midnight value on the day it names.
 */
export function formatFinanceDate(value: string | Date | null | undefined) {
  return formatCalendarDate(value, 'date', { empty: 'Sem data' })
}
