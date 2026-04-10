import { formatMoney } from '@calibra-facil/shared'

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

export function formatFinanceDate(value: string | Date | null | undefined) {
  if (!value) return 'Sem data'

  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return 'Sem data'

  return date.toLocaleDateString('pt-BR')
}
