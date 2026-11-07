import { createFileRoute } from '@tanstack/react-router'

import { ClientEquipmentTab } from '@/features/customers/assets-page'
import { loadCustomerAssetsData } from '@/features/customers/queries'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/clients/$id/assets')({
  loader: ({ context, params }) =>
    loadCustomerAssetsData(context.queryClient, params.id),
  head: () => routeHead('/dashboard/clients/$id/assets'),
  component: ClientEquipmentRoute,
})

function ClientEquipmentRoute() {
  const { id } = Route.useParams()

  return <ClientEquipmentTab id={id} />
}
