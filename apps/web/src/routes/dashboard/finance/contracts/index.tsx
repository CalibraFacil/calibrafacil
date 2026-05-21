import { createFileRoute } from '@tanstack/react-router'

import { FinanceContractsPage } from '@/features/finance/contracts-list-page'
import { loadFinanceContractsData } from '@/features/finance/queries'
import { routeLocationToUrl } from '@/lib/route-data'

export const Route = createFileRoute('/dashboard/finance/contracts/')({
  loader: ({ context, location }) =>
    loadFinanceContractsData(context.queryClient, routeLocationToUrl(location)),
  head: () => ({
    meta: [{ title: 'Contratos comerciais | CalibraFácil' }],
  }),
  component: FinanceContractsPage,
})
