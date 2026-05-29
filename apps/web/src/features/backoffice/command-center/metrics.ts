/**
 * Command center — pure derivation of platform vitals.
 *
 * The backoffice has no metrics endpoint; the rich customer-success account feed
 * (`customerSuccess.listOrganizations`) and the support queue
 * (`getSupportQueue`) already carry per-account health, attention scores, SLA
 * state and workflow violations. These functions aggregate those payloads into
 * the "what needs me now" signals the command center renders. Kept pure so the
 * derivation is unit-tested independently of React.
 */
import {
  onboardingLabels,
  migrationLabels,
  type HealthStatus,
  type MigrationStatus,
  type OnboardingStatus,
  type OrganizationQueueItem,
  type SupportRequest,
} from '../customer-success/model'

export type PlatformVitals = {
  totalAccounts: number
  healthCounts: Record<HealthStatus, number>
  /** Accounts the backend flags as needing attention right now. */
  accountsNeedingAttention: number
  /** Active delivery workflows with no internal owner (a governance gap). */
  missingOwners: number
  /** Accounts whose next action is past due. */
  overdueNextActions: number
  /** Accounts carrying at least one active blocker. */
  accountsWithBlockers: number
  /** Accounts the backend flags for escalation. */
  escalationAccounts: number
  /** Support — totals across the prioritized queue. */
  openTickets: number
  breachedTickets: number
  dueSoonTickets: number
  unassignedTickets: number
  escalationTickets: number
}

const OPEN_TICKET_STATUSES = new Set([
  'OPEN',
  'IN_PROGRESS',
  'WAITING_ON_CUSTOMER',
])

export function computePlatformVitals(
  accounts: ReadonlyArray<OrganizationQueueItem>,
  tickets: ReadonlyArray<SupportRequest>,
): PlatformVitals {
  const healthCounts: Record<HealthStatus, number> = {
    HEALTHY: 0,
    ATTENTION: 0,
    CRITICAL: 0,
  }

  let accountsNeedingAttention = 0
  let missingOwners = 0
  let overdueNextActions = 0
  let accountsWithBlockers = 0
  let escalationAccounts = 0

  for (const account of accounts) {
    const summary = account.operationalSummary
    healthCounts[summary.healthStatus] += 1

    if (summary.needsAttention) accountsNeedingAttention += 1
    if (summary.needsEscalation) escalationAccounts += 1
    if (summary.nextActionOverdue) overdueNextActions += 1
    if (summary.activeBlockersCount > 0) accountsWithBlockers += 1
    if (summary.workflow.hasActiveWorkflows && !summary.hasInternalOwner) {
      missingOwners += 1
    }
  }

  let openTickets = 0
  let breachedTickets = 0
  let dueSoonTickets = 0
  let unassignedTickets = 0
  let escalationTickets = 0

  for (const ticket of tickets) {
    const isOpen = OPEN_TICKET_STATUSES.has(ticket.status)
    if (isOpen) openTickets += 1
    if (ticket.slaStatus === 'BREACHED') breachedTickets += 1
    if (ticket.slaStatus === 'DUE_SOON') dueSoonTickets += 1
    if (isOpen && !ticket.assignedToUser) unassignedTickets += 1
    if (ticket.needsEscalation) escalationTickets += 1
  }

  return {
    totalAccounts: accounts.length,
    healthCounts,
    accountsNeedingAttention,
    missingOwners,
    overdueNextActions,
    accountsWithBlockers,
    escalationAccounts,
    openTickets,
    breachedTickets,
    dueSoonTickets,
    unassignedTickets,
    escalationTickets,
  }
}

export type PipelineBucket<T extends string> = {
  status: T
  label: string
  count: number
}

const ONBOARDING_ORDER: ReadonlyArray<OnboardingStatus> = [
  'NOT_STARTED',
  'DISCOVERY',
  'CONFIGURATION',
  'TRAINING',
  'LIVE',
  'BLOCKED',
]

const MIGRATION_ORDER: ReadonlyArray<MigrationStatus> = [
  'PLANNING',
  'IN_PROGRESS',
  'VALIDATION',
  'COMPLETED',
  'BLOCKED',
]

export function onboardingPipeline(
  accounts: ReadonlyArray<OrganizationQueueItem>,
): Array<PipelineBucket<OnboardingStatus>> {
  const counts = new Map<OnboardingStatus, number>()
  for (const account of accounts) {
    const status = account.profile.onboardingStatus
    counts.set(status, (counts.get(status) ?? 0) + 1)
  }
  return ONBOARDING_ORDER.map((status) => ({
    status,
    label: onboardingLabels[status],
    count: counts.get(status) ?? 0,
  }))
}

/** Migration pipeline, excluding the "not required" majority for signal. */
export function migrationPipeline(
  accounts: ReadonlyArray<OrganizationQueueItem>,
): Array<PipelineBucket<MigrationStatus>> {
  const counts = new Map<MigrationStatus, number>()
  for (const account of accounts) {
    const status = account.profile.migrationStatus
    counts.set(status, (counts.get(status) ?? 0) + 1)
  }
  return MIGRATION_ORDER.map((status) => ({
    status,
    label: migrationLabels[status],
    count: counts.get(status) ?? 0,
  }))
}

/** Accounts ranked by the backend attention score (highest first). */
export function topAttentionAccounts(
  accounts: ReadonlyArray<OrganizationQueueItem>,
  limit = 6,
): Array<OrganizationQueueItem> {
  return [...accounts]
    .filter((account) => account.operationalSummary.attentionScore > 0)
    .sort(
      (a, b) =>
        b.operationalSummary.attentionScore -
        a.operationalSummary.attentionScore,
    )
    .slice(0, limit)
}

/** Tickets ranked by attention score, breaches surfacing first. */
export function topAttentionTickets(
  tickets: ReadonlyArray<SupportRequest>,
  limit = 6,
): Array<SupportRequest> {
  return [...tickets]
    .sort((a, b) => b.attentionScore - a.attentionScore)
    .slice(0, limit)
}
