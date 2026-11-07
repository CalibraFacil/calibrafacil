import { createFileRoute } from '@tanstack/react-router'

import { FinanceLayout } from '@/features/finance/layout'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/finance')({
  head: () => routeHead('/dashboard/finance'),
  component: FinanceLayout,
})
