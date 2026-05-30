/**
 * Accounts directory — pure filter / search / ranking logic.
 *
 * Preserves the proven customer-success filter semantics (see the legacy
 * customer-success overview) while adding attention-ranked sorting and per-view
 * counts for the saved-view chips. Kept pure so it is unit-tested independently
 * of the table.
 */
import type {
  OrganizationFilter,
  OrganizationQueueItem,
} from '../customer-success/model'

export const ACCOUNT_VIEWS: ReadonlyArray<{
  value: OrganizationFilter
  label: string
}> = [
  { value: 'all', label: 'Todas' },
  { value: 'attention', label: 'Precisam de atenção' },
  { value: 'critical', label: 'Críticas' },
  { value: 'unassigned', label: 'Sem owner' },
  { value: 'overdue', label: 'Ação atrasada' },
  { value: 'escalation', label: 'Escalação' },
  { value: 'onboarding', label: 'Onboarding ativo' },
  { value: 'migration', label: 'Migração ativa' },
  { value: 'priority', label: 'Priority support' },
]

export function accountMatchesQuery(
  account: OrganizationQueueItem,
  query: string,
): boolean {
  if (query.length === 0) return true
  const haystack = [
    account.name,
    account.slug,
    account.accountOwnerName ?? '',
    account.internalOwnerUser?.name ?? '',
    account.accountOwnerEmail ?? '',
  ]
  return haystack.some((value) => value.toLowerCase().includes(query))
}

export function accountMatchesFilter(
  account: OrganizationQueueItem,
  filter: OrganizationFilter,
): boolean {
  const summary = account.operationalSummary
  switch (filter) {
    case 'attention':
      return summary.needsAttention
    case 'critical':
      return summary.healthStatus === 'CRITICAL'
    case 'priority':
      return summary.prioritySupport
    case 'onboarding':
      return (
        account.workflow.onboardingState !== 'INACTIVE' &&
        account.workflow.onboardingState !== 'COMPLETED'
      )
    case 'migration':
      return (
        account.workflow.migrationState !== 'INACTIVE' &&
        account.workflow.migrationState !== 'COMPLETED'
      )
    case 'overdue':
      return (
        summary.nextActionStatus === 'OVERDUE' ||
        summary.breachedRequestsCount > 0
      )
    case 'unassigned':
      return account.workflow.accountOwnershipStatus !== 'ASSIGNED'
    case 'escalation':
      return account.workflow.supportState === 'ESCALATED'
    default:
      return true
  }
}

/** Filter by saved view + free-text query, then rank by attention score. */
export function filterAccounts(
  accounts: ReadonlyArray<OrganizationQueueItem>,
  filter: OrganizationFilter,
  query: string,
): Array<OrganizationQueueItem> {
  const normalizedQuery = query.trim().toLowerCase()
  return accounts
    .filter(
      (account) =>
        accountMatchesQuery(account, normalizedQuery) &&
        accountMatchesFilter(account, filter),
    )
    .sort((a, b) => {
      const scoreDelta =
        b.operationalSummary.attentionScore -
        a.operationalSummary.attentionScore
      if (scoreDelta !== 0) return scoreDelta
      return a.name.localeCompare(b.name)
    })
}

/** Count of accounts matching each saved view (ignoring the text query). */
export function accountViewCounts(
  accounts: ReadonlyArray<OrganizationQueueItem>,
): Record<OrganizationFilter, number> {
  const counts: Record<OrganizationFilter, number> = {
    all: accounts.length,
    attention: 0,
    critical: 0,
    priority: 0,
    onboarding: 0,
    migration: 0,
    overdue: 0,
    unassigned: 0,
    escalation: 0,
  }
  for (const account of accounts) {
    for (const view of ACCOUNT_VIEWS) {
      if (view.value === 'all') continue
      if (accountMatchesFilter(account, view.value)) {
        counts[view.value] += 1
      }
    }
  }
  return counts
}
