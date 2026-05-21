import { createFileRoute } from '@tanstack/react-router'

import { MethodDetailPage } from '@/features/methods/detail-page'
import { loadMethodDetailData } from '@/features/methods/queries'

export const Route = createFileRoute('/dashboard/methods/$id/')({
  loader: ({ context, params }) =>
    loadMethodDetailData(context.queryClient, params.id),
  head: () => ({
    meta: [{ title: 'Detalhes do Método | CalibraFacil' }],
  }),
  component: MethodDetailRoute,
})

function MethodDetailRoute() {
  const { id } = Route.useParams()

  return <MethodDetailPage id={id} />
}
