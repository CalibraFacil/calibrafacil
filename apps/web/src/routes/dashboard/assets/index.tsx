import { createFileRoute } from '@tanstack/react-router'

import { AssetsPage } from '@/features/assets/list-page'
import { loadAssetsIndexData } from '@/features/assets/queries'
import { routeLocationToUrl } from '@/lib/route-data'

export const Route = createFileRoute('/dashboard/assets/')({
  loader: ({ context, location }) =>
    loadAssetsIndexData(context.queryClient, routeLocationToUrl(location)),
  head: () => ({
    meta: [{ title: 'Ativos | CalibraFácil' }],
  }),
  component: AssetsPage,
})
