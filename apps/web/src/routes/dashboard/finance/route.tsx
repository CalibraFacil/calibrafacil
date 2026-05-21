import { createFileRoute } from '@tanstack/react-router'

import { FinanceLayout } from '@/features/finance/layout'

export const Route = createFileRoute('/dashboard/finance')({
  head: () => ({
    meta: [{ title: 'Financeiro | CalibraFácil' }],
  }),
  component: FinanceLayout,
})
