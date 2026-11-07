import { createFileRoute } from '@tanstack/react-router'

import { SpcOverviewPage } from '@/features/spc/overview-page'
import { loadSpcIndexData } from '@/features/spc/queries'
import { routeLocationToUrl } from '@/lib/route-data'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/spc/')({
  loader: ({ context, location }) =>
    loadSpcIndexData(context.queryClient, routeLocationToUrl(location)),
  head: () => routeHead('/dashboard/spc'),
  component: SpcOverviewPage,
})
