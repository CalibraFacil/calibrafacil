import { createFileRoute } from '@tanstack/react-router'

import { CustomerGroupUnidadesTab } from '@/features/customer-groups/unidades-page'
import { loadCustomerGroupDetailData } from '@/features/customer-groups/queries'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute(
  '/dashboard/clients/groups/$groupId/unidades',
)({
  loader: ({ context, params }) =>
    loadCustomerGroupDetailData(
      context.queryClient,
      Number.parseInt(params.groupId, 10),
    ),
  head: () => routeHead('/dashboard/clients/groups/$groupId/unidades'),
  component: CustomerGroupUnidadesRoute,
})

function CustomerGroupUnidadesRoute() {
  const { groupId } = Route.useParams()

  return <CustomerGroupUnidadesTab groupId={Number.parseInt(groupId, 10)} />
}
