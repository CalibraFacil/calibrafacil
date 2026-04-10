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

export function BillingDocumentStatusBadge({
  status,
}: {
  status: string | null | undefined
}) {
  if (!status) return null

  return (
    <Badge variant={billingDocumentVariants[status] ?? 'secondary'}>
      {getBillingDocumentStatusLabel(status as BillingDocumentStatus)}
    </Badge>
  )
}

export function CommercialAgreementStatusBadge({
  status,
}: {
  status: string | null | undefined
}) {
  if (!status) return null

  return (
    <Badge variant={agreementVariants[status] ?? 'secondary'}>
      {getCommercialAgreementStatusLabel(status as CommercialAgreementStatus)}
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
