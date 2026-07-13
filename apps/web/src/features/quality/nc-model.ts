import type { OotNotificationData } from '@calibra-facil/client-runtime'

import type {
  NonConformanceDisposition,
  NonConformanceStatus,
} from '@/features/quality/types'

/**
 * The NC lifecycle in one place: which actions are legal in the record's
 * current state. The detail page renders what this returns — the ordering
 * rules (no resolution before disposition, no actions after resolution) are
 * enforced and tested here, not in JSX conditionals.
 */
export type NcAction = 'setDisposition' | 'resolve' | 'escalateToCapa'

export function ncAvailableActions(nc: {
  status: NonConformanceStatus
  disposition: NonConformanceDisposition
  capaId: number | null
}): NcAction[] {
  if (nc.status === 'resolved') {
    return []
  }

  const actions: NcAction[] = []
  if (!nc.disposition) {
    actions.push('setDisposition')
  } else {
    actions.push('resolve')
  }
  if (!nc.capaId) {
    actions.push('escalateToCapa')
  }

  return actions
}

export function getStatusBadge(status: string) {
  switch (status) {
    case 'open':
      return { variant: 'destructive' as const, label: 'Aberta' }
    case 'under_review':
      return { variant: 'outline' as const, label: 'Em Analise' }
    case 'resolved':
      return { variant: 'default' as const, label: 'Resolvida' }
    default:
      return { variant: 'secondary' as const, label: status }
  }
}

export function getDispositionLabel(disposition: string | null): string {
  if (!disposition) return 'Pendente'
  switch (disposition) {
    case 'rework':
      return 'Retrabalho'
    case 'scrap':
      return 'Sucata'
    case 'use_as_is':
      return 'Uso como esta'
    case 'concession':
      return 'Concessao'
    default:
      return disposition
  }
}

export function getTypeLabel(type: string): string {
  switch (type) {
    case 'work':
      return 'Trabalho'
    case 'equipment':
      return 'Equipamento'
    case 'documentation':
      return 'Documentacao'
    case 'out_of_tolerance':
      return 'Fora de tolerância'
    default:
      return type
  }
}

export function getOotStatusBadge(status: OotNotificationData['status']) {
  switch (status) {
    case 'ACKNOWLEDGED':
      return { variant: 'default' as const, label: 'Confirmada' }
    case 'SENT':
      return { variant: 'secondary' as const, label: 'Enviada' }
    case 'GENERATED':
    case 'PENDING':
    default:
      return { variant: 'outline' as const, label: 'Gerada' }
  }
}

export function getAcknowledgedViaLabel(
  via: NonNullable<OotNotificationData['acknowledgedVia']>,
): string {
  switch (via) {
    case 'email_link':
      return 'link do e-mail'
    case 'portal_link':
      return 'portal'
    case 'manual':
      return 'registro manual'
    default:
      return via
  }
}
