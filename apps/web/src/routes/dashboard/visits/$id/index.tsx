import { createFileRoute } from '@tanstack/react-router'

import { VisitDetailPage } from '@/features/visits/detail-page'

export const Route = createFileRoute('/dashboard/visits/$id/')({
  head: () => ({
    meta: [{ title: 'Visita | CalibraFácil' }],
  }),
  component: VisitDetailRoute,
})

function VisitDetailRoute() {
  const { id } = Route.useParams()

  return <VisitDetailPage visitId={Number(id)} />
}
