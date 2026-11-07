import { createFileRoute } from '@tanstack/react-router'

import { NCListPage } from '@/features/quality/nc-list-page'
import { loadNonConformancesIndexData } from '@/features/quality/queries'
import { routeLocationToUrl } from '@/lib/route-data'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/nc/')({
  loader: ({ context, location }) =>
    loadNonConformancesIndexData(
      context.queryClient,
      routeLocationToUrl(location),
    ),
  head: () => routeHead('/dashboard/nc'),
  component: NCListPage,
})
