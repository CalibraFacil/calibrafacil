import { createFileRoute } from '@tanstack/react-router'

import { FinanceBillingReadinessPage } from '@/features/finance/billing-readiness-page'
import { loadFinanceBillingReadinessData } from '@/features/finance/queries'
import { routeHead } from '@/app/router/route-registry'

type BillingReadinessSearch = { status?: string }

function parseBillingReadinessSearch(
  input: Record<string, unknown>,
): BillingReadinessSearch {
  return {
    status:
      typeof input.status === 'string' && input.status.length > 0
        ? input.status
        : undefined,
  }
}

export const Route = createFileRoute('/dashboard/finance/billing-readiness')({
  validateSearch: parseBillingReadinessSearch,
  loader: ({ context }) => loadFinanceBillingReadinessData(context.queryClient),
  head: () => routeHead('/dashboard/finance/billing-readiness'),
  component: FinanceBillingReadinessRoute,
})

function FinanceBillingReadinessRoute() {
  const search = Route.useSearch()
  return <FinanceBillingReadinessPage statusFilter={search.status} />
}
