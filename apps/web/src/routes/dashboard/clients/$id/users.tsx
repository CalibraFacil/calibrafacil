import { createFileRoute } from '@tanstack/react-router'

import { ClientUsersTab } from '@/features/customers/users-page'
import { loadCustomerUsersData } from '@/features/customers/queries'

export const Route = createFileRoute('/dashboard/clients/$id/users')({
  loader: ({ context, params }) =>
    loadCustomerUsersData(context.queryClient, params.id),
  component: ClientUsersRoute,
})

function ClientUsersRoute() {
  const { id } = Route.useParams()

  return <ClientUsersTab id={id} />
}
