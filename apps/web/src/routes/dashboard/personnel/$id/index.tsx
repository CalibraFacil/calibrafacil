import { createFileRoute } from '@tanstack/react-router'

import { CompetenceDetailPage } from '@/features/personnel/detail-page'
import { loadCompetenceDetailData } from '@/features/personnel/queries'

export const Route = createFileRoute('/dashboard/personnel/$id/')({
  loader: ({ context, params }) =>
    loadCompetenceDetailData(context.queryClient, params.id),
  head: () => ({
    meta: [{ title: 'Detalhes da Competência | CalibraFacil' }],
  }),
  component: CompetenceDetailRoute,
})

function CompetenceDetailRoute() {
  const { id } = Route.useParams()

  return <CompetenceDetailPage id={id} />
}
