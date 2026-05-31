import { createFileRoute } from '@tanstack/react-router'

import { CAPADetailPage } from '@/features/quality/capa-detail-page'

export const Route = createFileRoute('/dashboard/capa/$id/')({
  head: () => ({
    meta: [{ title: 'Detalhes CAPA | CalibraFácil' }],
  }),
  component: CAPADetailRoute,
})

function CAPADetailRoute() {
  const { id } = Route.useParams()

  return <CAPADetailPage id={id} />
}
