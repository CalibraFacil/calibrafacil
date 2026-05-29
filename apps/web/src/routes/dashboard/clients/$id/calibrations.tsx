import { createFileRoute } from '@tanstack/react-router'

import { ClientCalibrationsTab } from '@/features/customers/calibrations-page'
import { loadCustomerCalibrationsData } from '@/features/customers/queries'

export const Route = createFileRoute('/dashboard/clients/$id/calibrations')({
  loader: ({ context, params }) =>
    loadCustomerCalibrationsData(context.queryClient, params.id),
  head: () => ({
    meta: [{ title: 'Cliente | Calibrações | CalibraFácil' }],
  }),
  component: ClientCalibrationsRoute,
})

function ClientCalibrationsRoute() {
  const { id } = Route.useParams()

  return <ClientCalibrationsTab id={id} />
}
