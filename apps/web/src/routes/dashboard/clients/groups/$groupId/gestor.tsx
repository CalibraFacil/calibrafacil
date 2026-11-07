import { createFileRoute } from '@tanstack/react-router'

import { CustomerGroupGestorTab } from '@/features/customer-groups/gestor-page'
import { loadCustomerGroupGestorData } from '@/features/customer-groups/queries'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute(
  '/dashboard/clients/groups/$groupId/gestor',
)({
  loader: ({ context, params }) =>
    loadCustomerGroupGestorData(
      context.queryClient,
      Number.parseInt(params.groupId, 10),
    ),
  head: () => routeHead('/dashboard/clients/groups/$groupId/gestor'),
  component: CustomerGroupGestorRoute,
})

function CustomerGroupGestorRoute() {
  const { groupId } = Route.useParams()

  return <CustomerGroupGestorTab groupId={Number.parseInt(groupId, 10)} />
}
