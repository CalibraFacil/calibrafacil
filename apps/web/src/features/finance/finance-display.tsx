import type { SignalTone } from '@calibra-facil/shared/status-vocabulary'
import {
  BILLING_DOCUMENT_EXPORT_STATUS,
  BILLING_DOCUMENT_STATUS,
  RECEIVABLE_INSTALLMENT_STATUS,
  type BillingReadinessStatus,
} from '@calibra-facil/shared'

import { formatFinanceMoney } from '@/lib/finance-formatters'
import { cn } from '@calibra-facil/ui/utils'

// — Tone map. The finance statuses with a vocabulary (document, installment, export,
//   agreement) read it from `@calibra-facil/shared`; this one is `satisfies Record<Union, SignalTone>` so that if a
//   shared status enum gains a member, tsgo fails here until we classify it. —

const BILLING_READINESS_TONE = {
  READY: 'info',
  BLOCKED: 'critical',
  BILLED: 'neutral',
  SENT: 'ok',
} satisfies Record<BillingReadinessStatus, SignalTone>

export function billingReadinessTone(
  status: BillingReadinessStatus,
): SignalTone {
  return BILLING_READINESS_TONE[status]
}

// — String-accepting variants. The API hands back loose `string`s for status
//   fields; these parse-then-map so callers stay free of `as` assertions and
//   unknown values degrade gracefully to `neutral`. —

export function billingDocumentToneOf(status: string): SignalTone {
  const known = BILLING_DOCUMENT_STATUS.parse(status)
  return known ? BILLING_DOCUMENT_STATUS.tone(known) : 'neutral'
}

export function installmentToneOf(status: string): SignalTone {
  const known = RECEIVABLE_INSTALLMENT_STATUS.parse(status)
  return known ? RECEIVABLE_INSTALLMENT_STATUS.tone(known) : 'neutral'
}

export function exportStatusToneOf(status: string): SignalTone {
  const known = BILLING_DOCUMENT_EXPORT_STATUS.parse(status)
  return known ? BILLING_DOCUMENT_EXPORT_STATUS.tone(known) : 'neutral'
}

const MONEY_TONE_CLASS: Record<SignalTone, string> = {
  ok: 'text-emerald-700 dark:text-emerald-400',
  critical: 'text-destructive',
  warning: 'text-amber-700 dark:text-amber-400',
  info: 'text-primary',
  neutral: '',
}

/**
 * Canonical money rendering: mono + tabular-nums so columns of values align and
 * a digit never jumps as it changes. `tone` tints the value for at-a-glance
 * reads (e.g. overdue balances in destructive red). `muted` dims zero/empty
 * values so a wall of "R$ 0,00" recedes.
 */
export function Money({
  cents,
  currency,
  tone = 'neutral',
  muted = false,
  className,
}: {
  cents: number
  currency?: string
  tone?: SignalTone
  muted?: boolean
  className?: string
}) {
  return (
    <span
      className={cn(
        'font-mono tabular-nums',
        MONEY_TONE_CLASS[tone],
        muted && 'text-muted-foreground',
        className,
      )}
    >
      {formatFinanceMoney(cents, currency)}
    </span>
  )
}
