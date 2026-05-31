/**
 * Document lifecycle timeline — merges the audit trail and payment receipts
 * into one chronological event log (newest first) using the shared Timeline
 * primitive, so it reads like every other timeline in the app.
 */
import {
  Timeline,
  TimelineConnector,
  TimelineContent,
  TimelineDescription,
  TimelineDot,
  TimelineHeader,
  TimelineTime,
  TimelineItem,
  TimelineTitle,
} from '@/components/ui/timeline'
import { formatFinanceDate } from '@/lib/finance-formatters'
import { Money } from '@/features/finance/finance-display'
import type { SignalTone } from '@/components/instrument-panel'
import type { BillingDocumentDetails } from '@/features/finance/types'

type TimelineEvent = {
  key: string
  timestamp: number
  dateLabel: string
  title: string
  detail: string | null
  amountCents: number | null
  tone: SignalTone
}

// Audit actions arrive namespaced (e.g. "document.issue"); map both the
// namespaced and bare forms to lab-facing pt-BR labels.
const AUDIT_ACTION_LABELS: Record<string, string> = {
  'document.create': 'Documento criado',
  'document.update': 'Parâmetros atualizados',
  'document.issue': 'Documento emitido',
  'document.export': 'Exportado para o ERP',
  'document.void': 'Documento anulado',
  'document.receive': 'Baixa registrada',
  created: 'Documento criado',
  updated: 'Parâmetros atualizados',
  issued: 'Documento emitido',
  exported: 'Exportado para o ERP',
  voided: 'Documento anulado',
  received: 'Baixa registrada',
}

function auditLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action
}

function auditTone(action: string): SignalTone {
  if (action.endsWith('void') || action === 'voided') return 'critical'
  if (action.endsWith('receive') || action === 'received') return 'ok'
  if (
    action.endsWith('issue') ||
    action.endsWith('export') ||
    action === 'issued' ||
    action === 'exported'
  ) {
    return 'info'
  }
  return 'neutral'
}

const DOT_TONE_CLASS: Record<SignalTone, string> = {
  ok: 'border-emerald-500',
  critical: 'border-destructive',
  warning: 'border-amber-500',
  info: 'border-primary',
  neutral: 'border-border',
}

function toTimestamp(value: string): number {
  const parsed = new Date(value).getTime()
  return Number.isNaN(parsed) ? 0 : parsed
}

export function DocumentTimeline({
  audit,
  receipts,
  currency,
}: {
  audit: BillingDocumentDetails['audit']
  receipts: BillingDocumentDetails['receipts']
  currency: string
}) {
  const events: TimelineEvent[] = [
    ...audit.map((entry) => ({
      key: `audit-${entry.id}`,
      timestamp: toTimestamp(entry.performedAt),
      dateLabel: formatFinanceDate(entry.performedAt),
      title: auditLabel(entry.action),
      detail: entry.reason,
      amountCents: null,
      tone: auditTone(entry.action),
    })),
    ...receipts.map((receipt) => ({
      key: `receipt-${receipt.id}`,
      timestamp: toTimestamp(receipt.receivedAt),
      dateLabel: formatFinanceDate(receipt.receivedAt),
      title: 'Baixa registrada',
      detail: receipt.reference
        ? `${receipt.paymentMethod} · ${receipt.reference}`
        : receipt.paymentMethod,
      amountCents: receipt.amountCents,
      tone: 'ok' as const,
    })),
  ]
  // oxlint-disable-next-line unicorn/no-array-sort -- toSorted needs es2023; this array is freshly constructed so in-place sort is safe.
  events.sort((a, b) => b.timestamp - a.timestamp)

  if (events.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nenhum evento registrado ainda.
      </p>
    )
  }

  return (
    <Timeline activeIndex={events.length} className="[--timeline-dot-size:1rem]">
      {events.map((event) => (
        <TimelineItem key={event.key}>
          <TimelineDot className={DOT_TONE_CLASS[event.tone]} />
          <TimelineConnector />
          <TimelineContent>
            <TimelineHeader className="flex-row flex-wrap items-baseline justify-between gap-x-3">
              <TimelineTitle className="text-sm">{event.title}</TimelineTitle>
              <TimelineTime className="font-mono tabular-nums">
                {event.dateLabel}
              </TimelineTime>
            </TimelineHeader>
            {event.detail ? (
              <TimelineDescription>{event.detail}</TimelineDescription>
            ) : null}
            {event.amountCents !== null ? (
              <Money
                cents={event.amountCents}
                currency={currency}
                tone="ok"
                className="mt-0.5 text-sm"
              />
            ) : null}
          </TimelineContent>
        </TimelineItem>
      ))}
    </Timeline>
  )
}
