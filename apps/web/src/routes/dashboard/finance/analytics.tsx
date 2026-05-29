import { createFileRoute } from '@tanstack/react-router'

import { FinanceAnalyticsHubPage } from '@/features/finance/analytics-hub-page'

export const Route = createFileRoute('/dashboard/finance/analytics')({
  head: () => ({
    meta: [{ title: 'Análises financeiras | CalibraFácil' }],
  }),
  component: FinanceAnalyticsHubPage,
})
