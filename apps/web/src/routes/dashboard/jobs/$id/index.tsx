import { createFileRoute } from '@tanstack/react-router'

import { JobDetailPage } from '@/features/jobs/detail-page'

export const Route = createFileRoute('/dashboard/jobs/$id/')({
  head: () => ({
    meta: [{ title: 'Detalhes do Job | CalibraFácil' }],
  }),
  component: JobDetailRoute,
})

function JobDetailRoute() {
  const { id } = Route.useParams()
  const { runtime } = Route.useRouteContext()

  return <JobDetailPage id={id} runtime={runtime} />
}
