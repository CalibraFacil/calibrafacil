import { formatCalendarDate, formatMoney } from '@calibra-facil/shared/format'
import {
  MONEY_PARSE_FAILURE_MESSAGES,
  parseMoneyToCents,
  type ParseMoneyOptions,
} from '@calibra-facil/shared/money'

export type BillingMode = 'single' | 'consolidated'

export const FINANCE_CURRENCY = 'BRL'

export function formatFinanceMoney(value: number, currency = 'BRL') {
  return formatMoney(value ?? 0, currency)
}

/**
 * Field-error text for typed money, or null when the text is blank (a
 * required-field check is the caller's call) or reads as an amount.
 */
export function moneyFieldError(
  value: string,
  options: ParseMoneyOptions = {},
): string | null {
  const parsed = parseMoneyToCents(value, options)
  if (parsed.ok || parsed.reason === 'empty') return null
  return MONEY_PARSE_FAILURE_MESSAGES[parsed.reason]
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
