/**
 * Support inbox — pure triage logic.
 *
 * Preserves the proven ticket filter semantics and adds SLA-first ranking
 * (breached → due-soon → on-track) so the inbox is genuinely triage-ordered,
 * plus per-view counts for the saved-view chips.
 */
import type {
  SupportRequest,
  SupportSlaStatus,
  TicketFilter,
} from '../customer-success/model'

export const TICKET_VIEWS: ReadonlyArray<{
  value: TicketFilter
  label: string
}> = [
  { value: 'all', label: 'Todos' },
  { value: 'breached', label: 'SLA estourado' },
  { value: 'due', label: 'SLA vencendo' },
  { value: 'unassigned', label: 'Sem responsável' },
  { value: 'mine', label: 'Meus tickets' },
  { value: 'open', label: 'Em tratamento' },
  { value: 'waiting', label: 'Aguardando lab' },
  { value: 'escalation', label: 'Escalação' },
]

const SLA_SEVERITY: Record<SupportSlaStatus, number> = {
  BREACHED: 0,
  DUE_SOON: 1,
  ON_TRACK: 2,
  RESOLVED: 3,
}

export function ticketMatchesFilter(
  request: SupportRequest,
  filter: TicketFilter,
  userId: string | undefined,
): boolean {
  switch (filter) {
    case 'breached':
      return request.slaStatus === 'BREACHED'
    case 'due':
      return request.slaStatus === 'DUE_SOON'
    case 'open':
      return request.status === 'OPEN' || request.status === 'IN_PROGRESS'
    case 'mine':
      return request.assignedToUser?.id === userId
    case 'waiting':
      return request.status === 'WAITING_ON_CUSTOMER'
    case 'unassigned':
      return !request.assignedToUser
    case 'escalation':
      return request.needsEscalation || Boolean(request.escalationReason)
    default:
      return true
  }
}

function ticketMatchesQuery(request: SupportRequest, query: string): boolean {
  if (query.length === 0) return true
  return [
    request.subject,
    request.organization?.name ?? '',
    request.assignedToUser?.name ?? '',
    request.category,
  ].some((value) => value.toLowerCase().includes(query))
}

/** Filter by view + text, then rank SLA-first (breaches surface first). */
export function filterTickets(
  tickets: ReadonlyArray<SupportRequest>,
  filter: TicketFilter,
  userId: string | undefined,
  query: string,
): Array<SupportRequest> {
  const normalizedQuery = query.trim().toLowerCase()
  return tickets
    .filter(
      (request) =>
        ticketMatchesFilter(request, filter, userId) &&
        ticketMatchesQuery(request, normalizedQuery),
    )
    .sort((a, b) => {
      const severityDelta =
        SLA_SEVERITY[a.slaStatus] - SLA_SEVERITY[b.slaStatus]
      if (severityDelta !== 0) return severityDelta
      return b.attentionScore - a.attentionScore
    })
}

export function ticketViewCounts(
  tickets: ReadonlyArray<SupportRequest>,
  userId: string | undefined,
): Record<TicketFilter, number> {
  const counts: Record<TicketFilter, number> = {
    all: tickets.length,
    breached: 0,
    due: 0,
    open: 0,
    mine: 0,
    waiting: 0,
    unassigned: 0,
    escalation: 0,
  }
  for (const request of tickets) {
    for (const view of TICKET_VIEWS) {
      if (view.value === 'all') continue
      if (ticketMatchesFilter(request, view.value, userId)) {
        counts[view.value] += 1
      }
    }
  }
  return counts
}
