import { createFileRoute } from '@tanstack/react-router'

import { CompetenceDetailLayout } from '@/features/personnel/detail-layout'
import { loadCompetenceDetailData } from '@/features/personnel/queries'

export const Route = createFileRoute('/dashboard/personnel/$id')({
  loader: ({ context, params }) =>
    loadCompetenceDetailData(context.queryClient, params.id),
  component: CompetenceDetailRoute,
})

function CompetenceDetailRoute() {
  const { id } = Route.useParams()

  return <CompetenceDetailLayout id={id} />
}
