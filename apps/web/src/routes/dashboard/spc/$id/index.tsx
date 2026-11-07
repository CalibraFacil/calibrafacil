import { createFileRoute } from '@tanstack/react-router'

import { SpcChartPage } from '@/features/spc/chart-page'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/spc/$id/')({
  head: () => routeHead('/dashboard/spc/$id'),
  component: SpcChartDetailRoute,
})

function SpcChartDetailRoute() {
  const { id } = Route.useParams()

  return <SpcChartPage id={id} />
}
