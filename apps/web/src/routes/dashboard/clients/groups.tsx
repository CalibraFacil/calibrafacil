import { createFileRoute } from '@tanstack/react-router'

import { CustomerGroupsPage } from '@/features/customer-groups/page'

export const Route = createFileRoute('/dashboard/clients/groups')({
  head: () => ({
    meta: [{ title: 'Grupos de Clientes | CalibraFácil' }],
  }),
  component: CustomerGroupsPage,
})
