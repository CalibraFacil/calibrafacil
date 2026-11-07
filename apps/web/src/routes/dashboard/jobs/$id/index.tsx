import { createFileRoute } from '@tanstack/react-router'

import { JobDetailPage } from '@/features/jobs/detail-page'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/jobs/$id/')({
  head: () => routeHead('/dashboard/jobs/$id'),
  component: JobDetailRoute,
})

function JobDetailRoute() {
  const { id } = Route.useParams()

  return <JobDetailPage id={id} />
}
