import { createFileRoute } from '@tanstack/react-router'

import { MarginDashboardsPage } from '@/features/finance/margin-dashboards-page'

export const Route = createFileRoute('/dashboard/finance/margin-dashboards')({
  head: () => ({ meta: [{ title: 'Painel de margens | CalibraFácil' }] }),
  component: MarginDashboardsPage,
})
