import { createFileRoute } from '@tanstack/react-router'

import { RequestsPage } from '@/features/requests/list-page'
import { loadRequestsIndexData } from '@/features/requests/queries'
import { routeLocationToUrl } from '@/lib/route-data'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/requests/')({
  loader: ({ context, location }) =>
    loadRequestsIndexData(context.queryClient, routeLocationToUrl(location)),
  head: () => routeHead('/dashboard/requests'),
  component: RequestsPage,
})
