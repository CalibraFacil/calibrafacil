import { createFileRoute } from '@tanstack/react-router'

import { RevenueLeakagePage } from '@/features/finance/revenue-leakage-page'
import { routeHead } from '@/app/router/route-registry'

type RevenueLeakageSearch = { class?: string }

function parseRevenueLeakageSearch(
  input: Record<string, unknown>,
): RevenueLeakageSearch {
  return {
    class:
      typeof input.class === 'string' && input.class.length > 0
        ? input.class
        : undefined,
  }
}

export const Route = createFileRoute('/dashboard/finance/revenue-leakage')({
  validateSearch: parseRevenueLeakageSearch,
  head: () => routeHead('/dashboard/finance/revenue-leakage'),
  component: RevenueLeakageRoute,
})

function RevenueLeakageRoute() {
  const search = Route.useSearch()
  return <RevenueLeakagePage classFilter={search.class} />
}
