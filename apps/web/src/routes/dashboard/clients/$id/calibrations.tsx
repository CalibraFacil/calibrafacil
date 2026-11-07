import { createFileRoute } from '@tanstack/react-router'

import { ClientCalibrationsTab } from '@/features/customers/calibrations-page'
import { loadCustomerCalibrationsData } from '@/features/customers/queries'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/clients/$id/calibrations')({
  loader: ({ context, params }) =>
    loadCustomerCalibrationsData(context.queryClient, params.id),
  head: () => routeHead('/dashboard/clients/$id/calibrations'),
  component: ClientCalibrationsRoute,
})

function ClientCalibrationsRoute() {
  const { id } = Route.useParams()

  return <ClientCalibrationsTab id={id} />
}
