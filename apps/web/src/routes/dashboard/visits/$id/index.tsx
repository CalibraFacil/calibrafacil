import { createFileRoute } from '@tanstack/react-router'

import { VisitDetailPage } from '@/features/visits/detail-page'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/visits/$id/')({
  head: () => routeHead('/dashboard/visits/$id'),
  component: VisitDetailRoute,
})

function VisitDetailRoute() {
  const { id } = Route.useParams()

  return <VisitDetailPage visitId={Number(id)} />
}
