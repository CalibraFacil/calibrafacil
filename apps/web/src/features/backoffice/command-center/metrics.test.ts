import { describe, expect, it } from 'vitest'

import {
  computePlatformVitals,
  migrationPipeline,
  onboardingPipeline,
  topAttentionAccounts,
  topAttentionTickets,
} from './metrics'
import {
  makeQueueAccount,
  makeSupportRequest,
} from '../customer-success/test-fixtures'

describe('computePlatformVitals', () => {
  it('aggregates account health and risk signals', () => {
    const accounts = [
      makeQueueAccount({ health: 'HEALTHY' }),
      makeQueueAccount({ health: 'ATTENTION', needsAttention: true }),
      makeQueueAccount({
        health: 'CRITICAL',
        needsAttention: true,
        needsEscalation: true,
        nextActionOverdue: true,
        activeBlockersCount: 2,
        hasActiveWorkflows: true,
        hasInternalOwner: false,
      }),
    ]

    const vitals = computePlatformVitals(accounts, [])

    expect(vitals.totalAccounts).toBe(3)
    expect(vitals.healthCounts).toEqual({ HEALTHY: 1, ATTENTION: 1, CRITICAL: 1 })
    expect(vitals.accountsNeedingAttention).toBe(2)
    expect(vitals.escalationAccounts).toBe(1)
    expect(vitals.overdueNextActions).toBe(1)
    expect(vitals.accountsWithBlockers).toBe(1)
    expect(vitals.missingOwners).toBe(1)
  })

  it('counts only active workflows without an owner as missing owners', () => {
    const accounts = [
      makeQueueAccount({ hasActiveWorkflows: false, hasInternalOwner: false }),
      makeQueueAccount({ hasActiveWorkflows: true, hasInternalOwner: true }),
    ]
    expect(computePlatformVitals(accounts, []).missingOwners).toBe(0)
  })

  it('aggregates support SLA and assignment signals', () => {
    const tickets = [
      makeSupportRequest({ id: 1, slaStatus: 'BREACHED', status: 'OPEN' }),
      makeSupportRequest({
        id: 2,
        slaStatus: 'DUE_SOON',
        status: 'IN_PROGRESS',
        assigned: true,
      }),
      makeSupportRequest({ id: 3, status: 'OPEN' }),
      makeSupportRequest({ id: 4, status: 'CLOSED', assigned: true }),
      makeSupportRequest({ id: 5, status: 'OPEN', needsEscalation: true }),
    ]

    const vitals = computePlatformVitals([], tickets)

    expect(vitals.openTickets).toBe(4)
    expect(vitals.breachedTickets).toBe(1)
    expect(vitals.dueSoonTickets).toBe(1)
    expect(vitals.unassignedTickets).toBe(3)
    expect(vitals.escalationTickets).toBe(1)
  })
})

describe('pipelines and ranking', () => {
  it('buckets onboarding by stage in order', () => {
    const pipeline = onboardingPipeline([
      makeQueueAccount({ onboardingStatus: 'DISCOVERY' }),
      makeQueueAccount({ onboardingStatus: 'DISCOVERY' }),
      makeQueueAccount({ onboardingStatus: 'TRAINING' }),
    ])
    const discovery = pipeline.find((bucket) => bucket.status === 'DISCOVERY')
    const training = pipeline.find((bucket) => bucket.status === 'TRAINING')
    expect(discovery?.count).toBe(2)
    expect(training?.count).toBe(1)
    expect(pipeline[0]?.status).toBe('NOT_STARTED')
  })

  it('buckets migration by stage', () => {
    const pipeline = migrationPipeline([
      makeQueueAccount({ migrationStatus: 'IN_PROGRESS' }),
      makeQueueAccount({ migrationStatus: 'COMPLETED' }),
    ])
    expect(pipeline.find((b) => b.status === 'IN_PROGRESS')?.count).toBe(1)
    expect(pipeline.find((b) => b.status === 'COMPLETED')?.count).toBe(1)
  })

  it('ranks accounts by attention score and drops zero-score accounts', () => {
    const ranked = topAttentionAccounts([
      makeQueueAccount({ id: 'a', attentionScore: 10 }),
      makeQueueAccount({ id: 'b', attentionScore: 90 }),
      makeQueueAccount({ id: 'c', attentionScore: 0 }),
    ])
    expect(ranked.map((account) => account.id)).toEqual(['b', 'a'])
  })

  it('ranks tickets by attention score', () => {
    const ranked = topAttentionTickets([
      makeSupportRequest({ id: 1, attentionScore: 5 }),
      makeSupportRequest({ id: 2, attentionScore: 50 }),
    ])
    expect(ranked.map((ticket) => ticket.id)).toEqual([2, 1])
  })
})
