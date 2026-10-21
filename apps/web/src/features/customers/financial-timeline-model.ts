import type {
  CustomerFinancialTimelineDocument,
  FinancialFreshness,
} from '@calibra-facil/shared'
import { formatMoney } from '@calibra-facil/shared'
import { LAB_TIME_ZONE, formatDateOnly } from '@calibra-facil/documents'

const DATETIME_SHORT_FORMAT = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  // A sync moment reads the same in the browser and in the API's own text.
  timeZone: LAB_TIME_ZONE,
})

export function formatTimelineDate(value?: string | null) {
  // A due date is a calendar date (a Postgres date): the day it names.
  return formatDateOnly(value, 'Não informado', { dateStyle: 'short' })
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

  return `${freshness.label} em ${DATETIME_SHORT_FORMAT.format(
    new Date(freshness.lastSyncedAt),
  )}`
}
