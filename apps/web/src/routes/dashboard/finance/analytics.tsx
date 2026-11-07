import { createFileRoute } from '@tanstack/react-router'

import { FinanceAnalyticsHubPage } from '@/features/finance/analytics-hub-page'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/finance/analytics')({
  head: () => routeHead('/dashboard/finance/analytics'),
  component: FinanceAnalyticsHubPage,
})
