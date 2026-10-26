import { ChangeEvent, ComponentProps, FocusEvent, useId, useState } from 'react'
import { FieldError } from '@calibra-facil/ui/field'
import { Input } from '@calibra-facil/ui/input'
import { cn } from '@/lib/utils'
import {
  MONEY_PARSE_FAILURE_MESSAGES,
  formatCentsForEditing,
  parseMoneyToCents,
} from '@calibra-facil/shared/money'

const CURRENCY_SYMBOLS: Record<string, string> = {
  BRL: 'R$',
  USD: '$',
  EUR: '€',
}

type CurrencyInputProps = Omit<
  ComponentProps<typeof Input>,
  'value' | 'defaultValue' | 'onChange' | 'type' | 'inputMode'
> & {
  /** Current amount in cents — the single value the parent owns. */
  valueCents: number
  /**
   * Fired on every keystroke and on blur with the parsed integer cents, but
   * only while the text reads as an amount (a blank field is 0). Text that does
   * not parse never reaches the parent as a value: it stays on screen with an
   * error and `valueCents` keeps its last valid amount.
   */
  onValueChange: (cents: number) => void
  /**
   * Fired when the text turns into a readable amount (true) or an unreadable
   * one (false), so the parent can hold its save button while the field shows
   * an error.
   */
  onValidityChange?: (valid: boolean) => void
  currency?: string
}

/**
 * Currency-aware money input. The parent owns an integer `valueCents`; the
 * field edits a plain "1234,56" string and parses it with the shared strict
 * `parseMoneyToCents` ("1.234,56", "12.50" and "R$ 1.234,56" all read as the
 * amount they say). An unreadable entry shows a field error and is never
 * silently turned into 0 or rewritten on blur. No effects — the editable string
 * is seeded once from props; remount (key bump) if the parent needs to force a
 * new external value into a mounted field.
 */
export function CurrencyInput({
  valueCents,
  onValueChange,
  onValidityChange,
  currency = 'BRL',
  className,
  onBlur,
  ...props
}: CurrencyInputProps) {
  const errorId = useId()
  const [display, setDisplay] = useState(() =>
    formatCentsForEditing(valueCents),
  )
  const parsed = parseMoneyToCents(display)
  const failure = parsed.ok || parsed.reason === 'empty' ? null : parsed.reason

  function updateValueFromInput(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.value
    const result = parseMoneyToCents(next)
    setDisplay(next)
    if (result.ok) {
      onValueChange(result.cents)
      onValidityChange?.(true)
    } else if (result.reason === 'empty') {
      onValueChange(0)
      onValidityChange?.(true)
    } else {
      onValidityChange?.(false)
    }
  }

  function reformatOnBlur(event: FocusEvent<HTMLInputElement>) {
    if (parsed.ok) {
      setDisplay(formatCentsForEditing(parsed.cents))
      onValueChange(parsed.cents)
    } else if (parsed.reason === 'empty') {
      setDisplay(formatCentsForEditing(0))
      onValueChange(0)
    }
    onBlur?.(event)
  }

  const symbol = CURRENCY_SYMBOLS[currency] ?? currency
  const describedBy = [props['aria-describedby'], failure ? errorId : undefined]
    .filter(Boolean)
    .join(' ')

  return (
    <div>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm font-medium text-muted-foreground">
          {symbol}
        </span>
        <Input
          {...props}
          type="text"
          inputMode="decimal"
          value={display}
          onChange={updateValueFromInput}
          onBlur={reformatOnBlur}
          aria-invalid={failure ? true : props['aria-invalid']}
          aria-describedby={describedBy || undefined}
          className={cn('pl-10 text-right font-mono tabular-nums', className)}
        />
      </div>
      {failure ? (
        <FieldError id={errorId} className="mt-1">
          {MONEY_PARSE_FAILURE_MESSAGES[failure]}
        </FieldError>
      ) : null}
    </div>
  )
}
