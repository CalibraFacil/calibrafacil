import { Badge } from '@/components/ui/badge'
import {
  getBillingDocumentStatusLabel,
  getCommercialAgreementStatusLabel,
  type BillingDocumentStatus,
  type CommercialAgreementStatus,
} from '@calibra-facil/shared'

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline'

const billingDocumentVariants: Record<string, BadgeVariant> = {
  DRAFT: 'secondary',
  ISSUED: 'default',
  PAID: 'outline',
  OVERDUE: 'destructive',
  VOID: 'outline',
}

const agreementVariants: Record<string, BadgeVariant> = {
  DRAFT: 'secondary',
  ACTIVE: 'default',
  EXPIRED: 'outline',
  CANCELED: 'destructive',
}

const exportStatusMeta: Record<
  string,
  {
    label: string
    variant: BadgeVariant
  }
> = {
  NOT_EXPORTED: { label: 'Não exportado', variant: 'secondary' },
  PENDING: { label: 'Pendente', variant: 'default' },
  EXPORTED: { label: 'Exportado', variant: 'outline' },
  FAILED: { label: 'Falhou', variant: 'destructive' },
}

function parseBillingDocumentStatus(
  status: string,
): BillingDocumentStatus | null {
  switch (status) {
    case 'DRAFT':
    case 'ISSUED':
    case 'PAID':
    case 'OVERDUE':
    case 'VOID':
      return status
    default:
      return null
  }
}

function parseCommercialAgreementStatus(
  status: string,
): CommercialAgreementStatus | null {
  switch (status) {
    case 'DRAFT':
    case 'ACTIVE':
    case 'EXPIRED':
    case 'CANCELED':
      return status
    default:
      return null
  }
}

export function BillingDocumentStatusBadge({
  status,
}: {
  status: string | null | undefined
}) {
  if (!status) return null
  const parsedStatus = parseBillingDocumentStatus(status)

  return (
    <Badge variant={billingDocumentVariants[status] ?? 'secondary'}>
      {parsedStatus ? getBillingDocumentStatusLabel(parsedStatus) : status}
    </Badge>
  )
}

export function CommercialAgreementStatusBadge({
  status,
}: {
  status: string | null | undefined
}) {
  if (!status) return null
  const parsedStatus = parseCommercialAgreementStatus(status)

  return (
    <Badge variant={agreementVariants[status] ?? 'secondary'}>
      {parsedStatus ? getCommercialAgreementStatusLabel(parsedStatus) : status}
    </Badge>
  )
}

export function ExportStatusBadge({
  status,
}: {
  status: string | null | undefined
}) {
  if (!status) return null

  const meta = exportStatusMeta[status] ?? {
    label: status,
    variant: 'secondary' as const,
  }

  return <Badge variant={meta.variant}>{meta.label}</Badge>
}
