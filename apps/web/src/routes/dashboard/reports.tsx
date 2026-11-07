import { createFileRoute } from '@tanstack/react-router'

import { ConsolidatedReportsPage } from '@/features/reports/page'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/reports')({
  head: () => routeHead('/dashboard/reports'),
  component: ConsolidatedReportsPage,
})
