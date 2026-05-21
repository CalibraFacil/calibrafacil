import { createFileRoute } from '@tanstack/react-router'

import { ServiceOrdersPage } from '@/features/service-orders/list-page'
import { loadServiceOrdersIndexData } from '@/features/service-orders/queries'
import { routeLocationToUrl } from '@/lib/route-data'

export const Route = createFileRoute('/dashboard/service-orders/')({
  loader: ({ context, location }) =>
    loadServiceOrdersIndexData(
      context.queryClient,
      routeLocationToUrl(location),
    ),
  head: () => ({ meta: [{ title: 'Ordens de Serviço | CalibraFácil' }] }),
  component: ServiceOrdersPage,
})
