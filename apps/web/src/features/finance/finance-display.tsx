/**
 * Finance display conventions — the single source of truth for how monetary
 * values render and how finance status enums map onto the instrument-panel
 * `SignalTone` system. Keeping this here (rather than scattering Tailwind
 * classes across pages) is what lets every finance surface read the same way:
 * mono tabular numerics, and a consistent ok/critical/warning/info/neutral
 * signal language for documents, installments, exports, agreements and the
 * billing-readiness queue.
 */
import type { ReactNode } from 'react'
import type {
  BillingDocumentExportStatus,
  BillingDocumentStatus,
  BillingReadinessStatus,
  CommercialAgreementStatus,
  ReceivableInstallmentStatus,
} from '@calibra-facil/shared'

import { formatFinanceMoney } from '@/lib/finance-formatters'
import type { SignalTone } from '@/components/instrument-panel'
import { cn } from '@/lib/utils'

// — Tone maps. Each is `satisfies Record<Union, SignalTone>` so that if a
//   shared status enum gains a member, tsgo fails here until we classify it. —

const BILLING_DOCUMENT_TONE = {
  DRAFT: 'neutral',
  ISSUED: 'info',
  PAID: 'ok',
  OVERDUE: 'critical',
  VOID: 'neutral',
} satisfies Record<BillingDocumentStatus, SignalTone>

const INSTALLMENT_TONE = {
  OPEN: 'info',
  PAID: 'ok',
  OVERDUE: 'critical',
  VOID: 'neutral',
} satisfies Record<ReceivableInstallmentStatus, SignalTone>

const EXPORT_STATUS_TONE = {
  NOT_EXPORTED: 'neutral',
  PENDING: 'warning',
  EXPORTED: 'ok',
  FAILED: 'critical',
} satisfies Record<BillingDocumentExportStatus, SignalTone>

const AGREEMENT_TONE = {
  DRAFT: 'neutral',
  ACTIVE: 'ok',
  EXPIRED: 'warning',
  CANCELED: 'critical',
} satisfies Record<CommercialAgreementStatus, SignalTone>

const BILLING_READINESS_TONE = {
  READY: 'info',
  BLOCKED: 'critical',
  BILLED: 'neutral',
  SENT: 'ok',
} satisfies Record<BillingReadinessStatus, SignalTone>

export function billingDocumentTone(status: BillingDocumentStatus): SignalTone {
  return BILLING_DOCUMENT_TONE[status]
}

export function installmentTone(
  status: ReceivableInstallmentStatus,
): SignalTone {
  return INSTALLMENT_TONE[status]
}

export function exportStatusTone(
  status: BillingDocumentExportStatus,
): SignalTone {
  return EXPORT_STATUS_TONE[status]
}

export function agreementTone(status: CommercialAgreementStatus): SignalTone {
  return AGREEMENT_TONE[status]
}

export function billingReadinessTone(
  status: BillingReadinessStatus,
): SignalTone {
  return BILLING_READINESS_TONE[status]
}

// — String-accepting variants. The API hands back loose `string`s for status
//   fields; these parse-then-map so callers stay free of `as` assertions and
//   unknown values degrade gracefully to `neutral`. —

function asBillingDocumentStatus(value: string): BillingDocumentStatus | null {
  switch (value) {
    case 'DRAFT':
    case 'ISSUED':
    case 'PAID':
    case 'OVERDUE':
    case 'VOID':
      return value
    default:
      return null
  }
}

function asInstallmentStatus(
  value: string,
): ReceivableInstallmentStatus | null {
  switch (value) {
    case 'OPEN':
    case 'PAID':
    case 'OVERDUE':
    case 'VOID':
      return value
    default:
      return null
  }
}

function asExportStatus(value: string): BillingDocumentExportStatus | null {
  switch (value) {
    case 'NOT_EXPORTED':
    case 'PENDING':
    case 'EXPORTED':
    case 'FAILED':
      return value
    default:
      return null
  }
}

export function billingDocumentToneOf(status: string): SignalTone {
  const parsed = asBillingDocumentStatus(status)
  return parsed ? BILLING_DOCUMENT_TONE[parsed] : 'neutral'
}

export function installmentToneOf(status: string): SignalTone {
  const parsed = asInstallmentStatus(status)
  return parsed ? INSTALLMENT_TONE[parsed] : 'neutral'
}

export function exportStatusToneOf(status: string): SignalTone {
  const parsed = asExportStatus(status)
  return parsed ? EXPORT_STATUS_TONE[parsed] : 'neutral'
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

/** A label + Money pair for dense key/value blocks. */
export function MoneyStat({
  label,
  cents,
  currency,
  tone,
}: {
  label: ReactNode
  cents: number
  currency?: string
  tone?: SignalTone
}) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </p>
      <Money
        cents={cents}
        currency={currency}
        tone={tone}
        className="text-sm"
      />
    </div>
  )
}
