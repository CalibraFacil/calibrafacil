import { createFileRoute } from '@tanstack/react-router'

import { VisitsPage } from '@/features/visits/list-page'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/visits/')({
  head: () => routeHead('/dashboard/visits'),
  component: VisitsPage,
})
