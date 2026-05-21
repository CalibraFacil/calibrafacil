import { createFileRoute } from '@tanstack/react-router'

import { FinanceDocumentsPage } from '@/features/finance/documents-list-page'
import { loadFinanceDocumentsData } from '@/features/finance/queries'
import { routeLocationToUrl } from '@/lib/route-data'

export const Route = createFileRoute('/dashboard/finance/documents/')({
  loader: ({ context, location }) =>
    loadFinanceDocumentsData(context.queryClient, routeLocationToUrl(location)),
  head: () => ({
    meta: [{ title: 'Documentos financeiros | CalibraFácil' }],
  }),
  component: FinanceDocumentsPage,
})
