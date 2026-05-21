import { createFileRoute } from '@tanstack/react-router'

import { ClientEquipmentTab } from '@/features/customers/assets-page'

export const Route = createFileRoute('/dashboard/clients/$id/assets')({
  component: ClientEquipmentRoute,
})

function ClientEquipmentRoute() {
  const { id } = Route.useParams()

  return <ClientEquipmentTab id={id} />
}
