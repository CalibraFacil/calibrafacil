import { createFileRoute } from '@tanstack/react-router'

import { CalibrationRequestDetailPage } from '@/features/requests/detail-page'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/requests/$id/')({
  head: () => routeHead('/dashboard/requests/$id'),
  component: CalibrationRequestDetailRoute,
})

function CalibrationRequestDetailRoute() {
  const { id } = Route.useParams()

  return <CalibrationRequestDetailPage id={id} />
}
