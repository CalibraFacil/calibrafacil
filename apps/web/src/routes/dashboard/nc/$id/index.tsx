import { createFileRoute } from '@tanstack/react-router'

import { NCDetailPage } from '@/features/quality/nc-detail-page'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/nc/$id/')({
  head: () => routeHead('/dashboard/nc/$id'),
  component: NCDetailRoute,
})

function NCDetailRoute() {
  const { id } = Route.useParams()

  return <NCDetailPage id={id} />
}
