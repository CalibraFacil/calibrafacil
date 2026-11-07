import { createFileRoute } from '@tanstack/react-router'

import { AssetDetailPage } from '@/features/assets/detail-page'
import { loadAssetDetailData } from '@/features/assets/queries'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/assets/$id/')({
  loader: ({ context, params }) =>
    loadAssetDetailData(context.queryClient, params.id),
  head: () => routeHead('/dashboard/assets/$id'),
  component: AssetDetailRoute,
})

function AssetDetailRoute() {
  const { id } = Route.useParams()

  return <AssetDetailPage id={id} />
}
