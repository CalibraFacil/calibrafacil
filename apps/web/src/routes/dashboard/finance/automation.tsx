import { createFileRoute } from '@tanstack/react-router'

import { FinanceAutomationHubPage } from '@/features/finance/automation-hub-page'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/finance/automation')({
  head: () => routeHead('/dashboard/finance/automation'),
  component: FinanceAutomationHubPage,
})
