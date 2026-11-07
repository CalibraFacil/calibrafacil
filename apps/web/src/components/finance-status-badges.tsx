import {
  BILLING_DOCUMENT_EXPORT_STATUS,
  BILLING_DOCUMENT_STATUS,
  COMMERCIAL_AGREEMENT_STATUS,
} from '@calibra-facil/shared'
import type { StatusVocabulary } from '@calibra-facil/shared/status-vocabulary'
import { StatusBadge } from '@calibra-facil/ui/status-badge'

/** The pill for a status the API hands back as a loose string; an unknown value shows raw and neutral. */
function VocabularyStatusBadge<S extends string>({
  vocabulary,
  status,
}: {
  vocabulary: StatusVocabulary<S>
  status: string | null | undefined
}) {
  if (!status) return null
  const known = vocabulary.parse(status)

  return (
    <StatusBadge tone={known ? vocabulary.tone(known) : 'neutral'}>
      {known ? vocabulary.label(known) : status}
    </StatusBadge>
  )
}

export function BillingDocumentStatusBadge({
  status,
}: {
  status: string | null | undefined
}) {
  return (
    <VocabularyStatusBadge
      vocabulary={BILLING_DOCUMENT_STATUS}
      status={status}
    />
  )
}

export function CommercialAgreementStatusBadge({
  status,
}: {
  status: string | null | undefined
}) {
  return (
    <VocabularyStatusBadge
      vocabulary={COMMERCIAL_AGREEMENT_STATUS}
      status={status}
    />
  )
}

export function ExportStatusBadge({
  status,
}: {
  status: string | null | undefined
}) {
  return (
    <VocabularyStatusBadge
      vocabulary={BILLING_DOCUMENT_EXPORT_STATUS}
      status={status}
    />
  )
}
