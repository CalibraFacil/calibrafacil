import { createFileRoute } from '@tanstack/react-router'

import { ServicesListPage } from '@/features/services/list-page'
import { loadServicesIndexData } from '@/features/services/queries'
import { routeLocationToUrl } from '@/lib/route-data'

export const Route = createFileRoute('/dashboard/services/')({
  loader: ({ context, location }) =>
    loadServicesIndexData(context.queryClient, routeLocationToUrl(location)),
  head: () => ({
    meta: [{ title: 'Serviços | CalibraFácil' }],
  }),
  component: ServicesListPage,
})
