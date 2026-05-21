import { createFileRoute } from '@tanstack/react-router'

import { AssetDetailLayout } from '@/features/assets/detail-layout'
import { loadAssetHeaderData } from '@/features/assets/queries'

export const Route = createFileRoute('/dashboard/assets/$id')({
  loader: ({ context, params }) =>
    loadAssetHeaderData(context.queryClient, params.id),
  component: AssetDetailRoute,
})

function AssetDetailRoute() {
  const { id } = Route.useParams()

  return <AssetDetailLayout id={id} />
}
