import { createFileRoute } from '@tanstack/react-router'

import { CalibrationRequestDetailPage } from '@/features/requests/detail-page'

export const Route = createFileRoute('/dashboard/requests/$id/')({
  head: () => ({
    meta: [{ title: 'Solicitação de Calibração | CalibraFácil' }],
  }),
  component: CalibrationRequestDetailRoute,
})

function CalibrationRequestDetailRoute() {
  const { id } = Route.useParams()

  return <CalibrationRequestDetailPage id={id} />
}
