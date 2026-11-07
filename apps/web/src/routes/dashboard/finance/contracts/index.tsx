import { createFileRoute } from '@tanstack/react-router'

import { FinanceContractsPage } from '@/features/finance/contracts-list-page'
import { loadFinanceContractsData } from '@/features/finance/queries'
import { routeLocationToUrl } from '@/lib/route-data'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/finance/contracts/')({
  loader: ({ context, location }) =>
    loadFinanceContractsData(context.queryClient, routeLocationToUrl(location)),
  head: () => routeHead('/dashboard/finance/contracts'),
  component: FinanceContractsPage,
})
