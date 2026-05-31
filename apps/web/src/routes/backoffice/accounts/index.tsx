import { createFileRoute } from '@tanstack/react-router'

import { AccountsDirectoryPage } from '@/features/backoffice/accounts/directory-page'
import type { OrganizationFilter } from '@/features/backoffice/customer-success/model'

type AccountsSearch = {
  filter?: OrganizationFilter
  new?: 'lab'
}

const FILTER_VALUES: ReadonlyArray<OrganizationFilter> = [
  'all',
  'attention',
  'critical',
  'priority',
  'onboarding',
  'migration',
  'overdue',
  'unassigned',
  'escalation',
]

function parseFilter(value: unknown): OrganizationFilter | undefined {
  if (typeof value === 'string') {
    return FILTER_VALUES.find((candidate) => candidate === value)
  }
  return undefined
}

export const Route = createFileRoute('/backoffice/accounts/')({
  validateSearch: (search: Record<string, unknown>): AccountsSearch => ({
    filter: parseFilter(search.filter),
    new: search.new === 'lab' ? 'lab' : undefined,
  }),
  head: () => ({
    meta: [{ title: 'Contas | Backoffice | CalibraFácil' }],
  }),
  component: AccountsDirectoryRoute,
})

function AccountsDirectoryRoute() {
  const search = Route.useSearch()
  return (
    <AccountsDirectoryPage
      filter={search.filter ?? 'all'}
      provisionOpen={search.new === 'lab'}
    />
  )
}
