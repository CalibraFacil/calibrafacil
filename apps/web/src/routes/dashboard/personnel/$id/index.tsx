import { createFileRoute } from '@tanstack/react-router'

import { CompetenceDetailPage } from '@/features/personnel/detail-page'
import { loadCompetenceDetailData } from '@/features/personnel/queries'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/personnel/$id/')({
  loader: ({ context, params }) =>
    loadCompetenceDetailData(context.queryClient, params.id),
  head: () => routeHead('/dashboard/personnel/$id'),
  component: CompetenceDetailRoute,
})

function CompetenceDetailRoute() {
  const { id } = Route.useParams()

  return <CompetenceDetailPage id={id} />
}
