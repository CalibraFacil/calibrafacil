import { createFileRoute } from '@tanstack/react-router'

import { CustomerGroupOverviewTab } from '@/features/customer-groups/overview-page'
import { loadCustomerGroupDetailData } from '@/features/customer-groups/queries'

export const Route = createFileRoute(
  '/dashboard/clients/groups/$groupId/overview',
)({
  loader: ({ context, params }) =>
    loadCustomerGroupDetailData(
      context.queryClient,
      Number.parseInt(params.groupId, 10),
    ),
  head: () => ({
    meta: [{ title: 'Grupo | Visão geral | CalibraFácil' }],
  }),
  component: CustomerGroupOverviewRoute,
})

function CustomerGroupOverviewRoute() {
  const { groupId } = Route.useParams()

  return (
    <CustomerGroupOverviewTab groupId={Number.parseInt(groupId, 10)} />
  )
}
