import { Badge } from '@/components/ui/badge'

const STATUS_MAP: Record<
  string,
  {
    label: string
    variant: 'default' | 'secondary' | 'destructive' | 'outline'
  }
> = {
  DRAFT: { label: 'Rascunho', variant: 'secondary' },
  ISSUED: { label: 'Emitida', variant: 'secondary' },
  PENDING_PAYMENT: { label: 'Aguardando pagamento', variant: 'secondary' },
  PAID: { label: 'Paga', variant: 'default' },
  ACTIVATED: { label: 'Ativada', variant: 'default' },
  EXPIRED: { label: 'Expirada', variant: 'outline' },
  CANCELED: { label: 'Cancelada', variant: 'outline' },
  SUPERSEDED: { label: 'Substituída', variant: 'outline' },
  FAILED: { label: 'Falhou', variant: 'destructive' },
  ACTIVE: { label: 'Ativa', variant: 'default' },
  TRIAL: { label: 'Trial', variant: 'secondary' },
  PAST_DUE: { label: 'Inadimplente', variant: 'destructive' },
}

export function CommercialStatusBadge({
  status,
}: {
  status: string | null | undefined
}) {
  const mapped = STATUS_MAP[status || ''] || {
    label: status || 'Desconhecido',
    variant: 'outline' as const,
  }

  return <Badge variant={mapped.variant}>{mapped.label}</Badge>
}
