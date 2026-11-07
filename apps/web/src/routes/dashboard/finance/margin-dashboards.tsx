import { createFileRoute } from '@tanstack/react-router'

import { MarginDashboardsPage } from '@/features/finance/margin-dashboards-page'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/finance/margin-dashboards')({
  head: () => routeHead('/dashboard/finance/margin-dashboards'),
  component: MarginDashboardsPage,
})
