import { createFileRoute } from '@tanstack/react-router'

import { ServicesListPage } from '@/features/services/list-page'
import { loadServicesIndexData } from '@/features/services/queries'
import { routeLocationToUrl } from '@/lib/route-data'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/services/')({
  loader: ({ context, location }) =>
    loadServicesIndexData(context.queryClient, routeLocationToUrl(location)),
  head: () => routeHead('/dashboard/services'),
  component: ServicesListPage,
})
