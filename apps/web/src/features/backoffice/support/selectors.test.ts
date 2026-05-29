import { describe, expect, it } from 'vitest'

import { filterTickets, ticketViewCounts } from './selectors'
import { makeSupportRequest } from '../customer-success/test-fixtures'

describe('filterTickets', () => {
  it('ranks breaches first, then by attention score', () => {
    const tickets = [
      makeSupportRequest({ id: 1, slaStatus: 'ON_TRACK', attentionScore: 5 }),
      makeSupportRequest({ id: 2, slaStatus: 'BREACHED', attentionScore: 10 }),
      makeSupportRequest({ id: 3, slaStatus: 'DUE_SOON', attentionScore: 99 }),
      makeSupportRequest({ id: 4, slaStatus: 'BREACHED', attentionScore: 80 }),
    ]
    expect(filterTickets(tickets, 'all', undefined, '').map((t) => t.id)).toEqual(
      [4, 2, 3, 1],
    )
  })

  it('filters "mine" by assignee id', () => {
    const tickets = [
      makeSupportRequest({ id: 1, assigned: true }),
      makeSupportRequest({ id: 2, assigned: false }),
    ]
    expect(
      filterTickets(tickets, 'mine', 'op-1', '').map((t) => t.id),
    ).toEqual([1])
  })

  it('filters unassigned tickets', () => {
    const tickets = [
      makeSupportRequest({ id: 1, assigned: true }),
      makeSupportRequest({ id: 2, assigned: false }),
    ]
    expect(
      filterTickets(tickets, 'unassigned', undefined, '').map((t) => t.id),
    ).toEqual([2])
  })
})

describe('ticketViewCounts', () => {
  it('counts each view independently', () => {
    const tickets = [
      makeSupportRequest({ id: 1, slaStatus: 'BREACHED' }),
      makeSupportRequest({ id: 2, slaStatus: 'DUE_SOON', assigned: false }),
      makeSupportRequest({ id: 3, needsEscalation: true }),
    ]
    const counts = ticketViewCounts(tickets, undefined)
    expect(counts.all).toBe(3)
    expect(counts.breached).toBe(1)
    expect(counts.due).toBe(1)
    expect(counts.escalation).toBe(1)
    expect(counts.unassigned).toBe(3)
  })
})
