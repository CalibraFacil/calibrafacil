import { createFileRoute } from '@tanstack/react-router'

import { ServiceOrdersPage } from '@/features/service-orders/list-page'
import { loadServiceOrdersIndexData } from '@/features/service-orders/queries'
import { routeLocationToUrl } from '@/lib/route-data'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/service-orders/')({
  loader: ({ context, location }) =>
    loadServiceOrdersIndexData(
      context.queryClient,
      routeLocationToUrl(location),
    ),
  head: () => routeHead('/dashboard/service-orders'),
  component: ServiceOrdersPage,
})
