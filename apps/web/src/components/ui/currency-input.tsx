import * as React from 'react'

import { Input } from '@/components/ui/input'
import { parseFinanceCurrencyInputToCents } from '@/lib/finance-formatters'
import { cn } from '@/lib/utils'

/**
 * Format cents as a plain editable decimal string ("1234,56") — deliberately
 * WITHOUT thousand separators so it round-trips cleanly through
 * `parseFinanceCurrencyInputToCents` (which treats a single comma as the
 * decimal mark). The pretty grouped/symbol rendering is the job of
 * `<Money>`/`formatFinanceMoney`; this is the edit affordance only.
 */
function formatCentsForEditing(cents: number) {
  return new Intl.NumberFormat('pt-BR', {
    useGrouping: false,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format((Number.isFinite(cents) ? cents : 0) / 100)
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  BRL: 'R$',
  USD: '$',
  EUR: '€',
}

type CurrencyInputProps = Omit<
  React.ComponentProps<typeof Input>,
  'value' | 'defaultValue' | 'onChange' | 'type' | 'inputMode'
> & {
  /** Current amount in cents — the single value the parent owns. */
  valueCents: number
  /** Fired on every keystroke and on blur, with the parsed integer cents. */
  onValueChange: (cents: number) => void
  currency?: string
}

/**
 * Currency-aware money input. The parent owns an integer `valueCents`; the
 * field edits a plain "1234,56" string and emits parsed cents. On blur it
 * normalizes the visible text back to a canonical 2-decimal form. No effects —
 * the editable string is seeded once from props; remount (key bump) if the
 * parent needs to force a new external value into a mounted field.
 */
export function CurrencyInput({
  valueCents,
  onValueChange,
  currency = 'BRL',
  className,
  onBlur,
  ...props
}: CurrencyInputProps) {
  const [display, setDisplay] = React.useState(() =>
    formatCentsForEditing(valueCents),
  )

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const next = event.target.value
    setDisplay(next)
    onValueChange(parseFinanceCurrencyInputToCents(next))
  }

  function handleBlur(event: React.FocusEvent<HTMLInputElement>) {
    const cents = parseFinanceCurrencyInputToCents(display)
    setDisplay(formatCentsForEditing(cents))
    onValueChange(cents)
    onBlur?.(event)
  }

  const symbol = CURRENCY_SYMBOLS[currency] ?? currency

  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm font-medium text-muted-foreground">
        {symbol}
      </span>
      <Input
        {...props}
        type="text"
        inputMode="decimal"
        value={display}
        onChange={handleChange}
        onBlur={handleBlur}
        className={cn('pl-10 text-right font-mono tabular-nums', className)}
      />
    </div>
  )
}
