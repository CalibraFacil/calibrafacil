import type {
  CustomerFinancialTimelineDocument,
  FinancialFreshness,
} from '@calibra-facil/shared'
import { formatMoney } from '@calibra-facil/shared'

export function formatTimelineDate(value?: string | null) {
  if (!value) return 'Não informado'
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
  }).format(new Date(value))
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

  return `${freshness.label} em ${new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(freshness.lastSyncedAt))}`
}
