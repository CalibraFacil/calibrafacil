import { createFileRoute } from '@tanstack/react-router'

import { NCDetailPage } from '@/features/quality/nc-detail-page'

export const Route = createFileRoute('/dashboard/nc/$id/')({
  head: () => ({
    meta: [{ title: 'Detalhes da NC | CalibraFacil' }],
  }),
  component: NCDetailRoute,
})

function NCDetailRoute() {
  const { id } = Route.useParams()

  return <NCDetailPage id={id} />
}
