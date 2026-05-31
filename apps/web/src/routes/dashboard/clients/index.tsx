import { createFileRoute } from '@tanstack/react-router'

import { ClientsPage } from '@/features/customers/list-page'
import { loadCustomersIndexData } from '@/features/customers/queries'
import { routeLocationToUrl } from '@/lib/route-data'

export const Route = createFileRoute('/dashboard/clients/')({
  loader: ({ context, location }) =>
    loadCustomersIndexData(context.queryClient, routeLocationToUrl(location)),
  head: () => ({
    meta: [{ title: 'Clientes | CalibraFácil' }],
  }),
  component: ClientsPage,
})
