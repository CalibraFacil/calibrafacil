import { describe, expect, it } from 'vitest'

import {
  accountMatchesFilter,
  accountViewCounts,
  filterAccounts,
} from './selectors'
import { makeQueueAccount } from '../customer-success/test-fixtures'

describe('accountMatchesFilter', () => {
  it('matches critical health', () => {
    expect(
      accountMatchesFilter(
        makeQueueAccount({ health: 'CRITICAL' }),
        'critical',
      ),
    ).toBe(true)
    expect(
      accountMatchesFilter(makeQueueAccount({ health: 'HEALTHY' }), 'critical'),
    ).toBe(false)
  })

  it('treats any non-assigned ownership as unassigned', () => {
    expect(
      accountMatchesFilter(
        makeQueueAccount({ accountOwnershipStatus: 'UNASSIGNED' }),
        'unassigned',
      ),
    ).toBe(true)
    expect(
      accountMatchesFilter(
        makeQueueAccount({ accountOwnershipStatus: 'ASSIGNED' }),
        'unassigned',
      ),
    ).toBe(false)
  })

  it('matches active (not completed) onboarding for the onboarding view', () => {
    expect(
      accountMatchesFilter(
        makeQueueAccount({ onboardingState: 'ACTIVE' }),
        'onboarding',
      ),
    ).toBe(true)
    expect(
      accountMatchesFilter(
        makeQueueAccount({ onboardingState: 'COMPLETED' }),
        'onboarding',
      ),
    ).toBe(false)
  })

  it('flags overdue next action or breached SLA as overdue', () => {
    expect(
      accountMatchesFilter(
        makeQueueAccount({ nextActionStatus: 'OVERDUE' }),
        'overdue',
      ),
    ).toBe(true)
    expect(
      accountMatchesFilter(
        makeQueueAccount({ breachedRequestsCount: 1 }),
        'overdue',
      ),
    ).toBe(true)
  })
})

describe('filterAccounts', () => {
  it('filters by query across name, slug and owner', () => {
    const accounts = [
      makeQueueAccount({ id: 'a', name: 'Acme Metrologia', slug: 'acme' }),
      makeQueueAccount({ id: 'b', name: 'Beta Labs', slug: 'beta' }),
    ]
    expect(filterAccounts(accounts, 'all', 'acme').map((a) => a.id)).toEqual([
      'a',
    ])
    expect(filterAccounts(accounts, 'all', 'beta').map((a) => a.id)).toEqual([
      'b',
    ])
  })

  it('ranks by attention score, then name', () => {
    const accounts = [
      makeQueueAccount({ id: 'low', name: 'Z', attentionScore: 10 }),
      makeQueueAccount({ id: 'high', name: 'A', attentionScore: 80 }),
      makeQueueAccount({ id: 'mid-a', name: 'A2', attentionScore: 40 }),
      makeQueueAccount({ id: 'mid-b', name: 'A1', attentionScore: 40 }),
    ]
    expect(filterAccounts(accounts, 'all', '').map((a) => a.id)).toEqual([
      'high',
      'mid-b',
      'mid-a',
      'low',
    ])
  })

  it('combines view filter and query', () => {
    const accounts = [
      makeQueueAccount({ id: 'a', name: 'Acme', health: 'CRITICAL' }),
      makeQueueAccount({ id: 'b', name: 'Acme Two', health: 'HEALTHY' }),
    ]
    expect(
      filterAccounts(accounts, 'critical', 'acme').map((a) => a.id),
    ).toEqual(['a'])
  })
})

describe('accountViewCounts', () => {
  it('counts each view independently and "all" as total', () => {
    const accounts = [
      makeQueueAccount({ health: 'CRITICAL', needsAttention: true }),
      makeQueueAccount({ health: 'HEALTHY', prioritySupport: true }),
      makeQueueAccount({ health: 'HEALTHY' }),
    ]
    const counts = accountViewCounts(accounts)
    expect(counts.all).toBe(3)
    expect(counts.critical).toBe(1)
    expect(counts.attention).toBe(1)
    expect(counts.priority).toBe(1)
  })
})
