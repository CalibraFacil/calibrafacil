import { createFileRoute } from '@tanstack/react-router'

import { CustomerGroupsPage } from '@/features/customer-groups/page'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/clients/groups/')({
  head: () => routeHead('/dashboard/clients/groups'),
  component: CustomerGroupsPage,
})
