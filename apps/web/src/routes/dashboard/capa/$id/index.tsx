import { createFileRoute } from '@tanstack/react-router'

import { CAPADetailPage } from '@/features/quality/capa-detail-page'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/capa/$id/')({
  head: () => routeHead('/dashboard/capa/$id'),
  component: CAPADetailRoute,
})

function CAPADetailRoute() {
  const { id } = Route.useParams()

  return <CAPADetailPage id={id} />
}
