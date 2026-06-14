import { createFileRoute, redirect } from '@tanstack/react-router'

import { CustomerGroupDetailLayout } from '@/features/customer-groups/detail-layout'
import { loadCustomerGroupDetailData } from '@/features/customer-groups/queries'

function parseGroupId(raw: string): number {
  const groupId = Number.parseInt(raw, 10)
  if (!Number.isInteger(groupId) || groupId <= 0) {
    throw redirect({ to: '/dashboard/clients/groups' })
  }
  return groupId
}

export const Route = createFileRoute('/dashboard/clients/groups/$groupId')({
  loader: ({ context, params }) =>
    loadCustomerGroupDetailData(context.queryClient, parseGroupId(params.groupId)),
  component: CustomerGroupDetailRoute,
})

function CustomerGroupDetailRoute() {
  const { groupId } = Route.useParams()

  return <CustomerGroupDetailLayout groupId={parseGroupId(groupId)} />
}
