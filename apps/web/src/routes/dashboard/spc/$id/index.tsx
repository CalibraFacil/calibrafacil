import { createFileRoute } from '@tanstack/react-router'

import { SpcChartPage } from '@/features/spc/chart-page'

export const Route = createFileRoute('/dashboard/spc/$id/')({
  head: () => ({
    meta: [{ title: 'Carta de Controle | CalibraFácil' }],
  }),
  component: SpcChartDetailRoute,
})

function SpcChartDetailRoute() {
  const { id } = Route.useParams()

  return <SpcChartPage id={id} />
}
