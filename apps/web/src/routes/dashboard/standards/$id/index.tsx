import { createFileRoute } from '@tanstack/react-router'

import { StandardDetailPage } from '@/features/standards/detail-page'
import { loadStandardDetailData } from '@/features/standards/queries'

export const Route = createFileRoute('/dashboard/standards/$id/')({
  loader: ({ context, params }) =>
    loadStandardDetailData(context.queryClient, params.id),
  head: () => ({
    meta: [{ title: 'Detalhes do Padrão | CalibraFácil' }],
  }),
  component: StandardDetailRoute,
})

function StandardDetailRoute() {
  const { id } = Route.useParams()

  return <StandardDetailPage id={id} />
}
