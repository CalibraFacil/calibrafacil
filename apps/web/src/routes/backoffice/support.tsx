import { createFileRoute } from '@tanstack/react-router'

import { loadBackofficeSupportData } from '@/features/backoffice/queries'
import { SupportInboxPage } from '@/features/backoffice/support/inbox-page'
import type { TicketFilter } from '@/features/backoffice/customer-success/model'

type SupportSearch = {
  filter?: TicketFilter
  view?: 'list' | 'board'
}

const FILTER_VALUES: ReadonlyArray<TicketFilter> = [
  'all',
  'breached',
  'due',
  'open',
  'mine',
  'waiting',
  'unassigned',
  'escalation',
]

function parseFilter(value: unknown): TicketFilter | undefined {
  if (typeof value === 'string') {
    return FILTER_VALUES.find((candidate) => candidate === value)
  }
  return undefined
}

export const Route = createFileRoute('/backoffice/support')({
  validateSearch: (search: Record<string, unknown>): SupportSearch => ({
    filter: parseFilter(search.filter),
    view: search.view === 'board' ? 'board' : undefined,
  }),
  head: () => ({
    meta: [{ title: 'Suporte | Backoffice | CalibraFácil' }],
  }),
  loader: ({ context }) => loadBackofficeSupportData(context.queryClient),
  component: SupportRoute,
})

function SupportRoute() {
  const search = Route.useSearch()
  return (
    <SupportInboxPage
      filter={search.filter ?? 'all'}
      view={search.view ?? 'list'}
    />
  )
}
