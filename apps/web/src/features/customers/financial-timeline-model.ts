import type {
  CustomerFinancialTimelineDocument,
  FinancialFreshness,
} from '@calibra-facil/shared'
import {
  formatCalendarDate,
  formatInstant,
  formatMoney,
} from '@calibra-facil/shared/format'

export function formatTimelineDate(value?: string | null) {
  // A due date is a calendar date (a Postgres date): the day it names.
  return formatCalendarDate(value, 'date', { empty: 'Não informado' })
}

export function customerFinancialTimelineRow(
  document: CustomerFinancialTimelineDocument,
) {
  const paidCents = document.receipts.reduce(
    (sum, receipt) => sum + receipt.amountCents,
    0,
  )
  const fiscalLabel = document.fiscalDocuments[0]?.label ?? null

  return {
    title: document.documentNumber
      ? `Documento ${document.documentNumber}`
      : `Documento #${document.id}`,
    statusLabel: document.label,
    amountLabel: formatMoney(document.totalCents, document.currency),
    dueDateLabel: formatTimelineDate(document.dueDate),
    paidLabel: formatMoney(paidCents, document.currency),
    fiscalLabel,
    evidenceLabel: document.providerEvidence?.label ?? document.freshness.label,
    evidenceReconnectPath: document.providerEvidence?.reconnectPath ?? null,
    evidenceReconnectLabel: document.providerEvidence?.reconnectPath
      ? 'Reconectar'
      : null,
  }
}

export function customerTimelineFreshnessLabel(
  freshness: FinancialFreshness | null,
) {
  if (!freshness) return 'Status local'
  if (!freshness.lastSyncedAt) return freshness.label

  return `${freshness.label} em ${formatInstant(
    freshness.lastSyncedAt,
    'date-time',
  )}`
}
