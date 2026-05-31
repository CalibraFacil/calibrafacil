import { createFileRoute } from '@tanstack/react-router'

import { StandardsListPage } from '@/features/standards/list-page'
import { loadStandardsIndexData } from '@/features/standards/queries'
import { routeLocationToUrl } from '@/lib/route-data'

export const Route = createFileRoute('/dashboard/standards/')({
  loader: ({ context, location }) =>
    loadStandardsIndexData(context.queryClient, routeLocationToUrl(location)),
  head: () => ({
    meta: [{ title: 'Padroes de Referencia | CalibraFacil' }],
  }),
  component: StandardsListPage,
})
