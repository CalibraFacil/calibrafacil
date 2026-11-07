import { createFileRoute } from '@tanstack/react-router'

import { NewClientPage } from '@/features/customers/new-page'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/clients/new')({
  head: () => routeHead('/dashboard/clients/new'),
  component: NewClientPage,
})
