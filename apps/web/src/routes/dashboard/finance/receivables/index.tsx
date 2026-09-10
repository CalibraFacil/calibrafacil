import { createFileRoute } from '@tanstack/react-router'

import { FinanceReceivablesPage } from '@/features/finance/receivables/receivables-workspace-page'
import { parseReceivablesSearch } from '@/features/finance/receivables/receivables-search'
import {
  loadFinanceDocumentsData,
  loadFinanceReceiptsData,
} from '@/features/finance/queries'
import { routeLocationToUrl } from '@/lib/route-data'

export const Route = createFileRoute('/dashboard/finance/receivables/')({
  validateSearch: parseReceivablesSearch,
  loader: ({ context, location }) =>
    Promise.all([
      loadFinanceDocumentsData(
        context.queryClient,
        routeLocationToUrl(location),
      ),
      loadFinanceReceiptsData(context.queryClient),
    ]),
  head: () => ({
    meta: [{ title: 'Recebíveis | CalibraFácil' }],
  }),
  component: FinanceReceivablesRoute,
})

function FinanceReceivablesRoute() {
  const search = Route.useSearch()
  return <FinanceReceivablesPage search={search} />
}
