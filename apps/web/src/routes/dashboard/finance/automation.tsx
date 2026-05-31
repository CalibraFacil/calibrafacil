import { createFileRoute } from '@tanstack/react-router'

import { FinanceAutomationHubPage } from '@/features/finance/automation-hub-page'

export const Route = createFileRoute('/dashboard/finance/automation')({
  head: () => ({
    meta: [{ title: 'Automação financeira | CalibraFácil' }],
  }),
  component: FinanceAutomationHubPage,
})
