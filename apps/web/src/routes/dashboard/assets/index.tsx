import { createFileRoute } from '@tanstack/react-router'

import { AssetsPage } from '@/features/assets/list-page'
import { loadAssetsIndexData } from '@/features/assets/queries'
import { routeLocationToUrl } from '@/lib/route-data'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/assets/')({
  loader: ({ context, location }) =>
    loadAssetsIndexData(context.queryClient, routeLocationToUrl(location)),
  head: () => routeHead('/dashboard/assets'),
  component: AssetsPage,
})
