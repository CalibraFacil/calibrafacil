import { createFileRoute } from '@tanstack/react-router'

import { AssetDetailPage } from '@/features/assets/detail-page'
import { loadAssetDetailData } from '@/features/assets/queries'

export const Route = createFileRoute('/dashboard/assets/$id/')({
  loader: ({ context, params }) =>
    loadAssetDetailData(context.queryClient, params.id),
  head: () => ({
    meta: [{ title: 'Detalhes do Ativo | CalibraFácil' }],
  }),
  component: AssetDetailRoute,
})

function AssetDetailRoute() {
  const { id } = Route.useParams()

  return <AssetDetailPage id={id} />
}
