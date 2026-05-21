import { createFileRoute } from '@tanstack/react-router'

import { ClientCalibrationsTab } from '@/features/customers/calibrations-page'

export const Route = createFileRoute('/dashboard/clients/$id/calibrations')({
  head: () => ({
    meta: [{ title: 'Cliente | Calibrações | CalibraFácil' }],
  }),
  component: ClientCalibrationsRoute,
})

function ClientCalibrationsRoute() {
  const { id } = Route.useParams()

  return <ClientCalibrationsTab id={id} />
}
