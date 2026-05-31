import { createFileRoute } from '@tanstack/react-router'

import { FinanceOverviewPage } from '@/features/finance/overview-page'
import { loadFinanceOverviewData } from '@/features/finance/queries'

export const Route = createFileRoute('/dashboard/finance/')({
  loader: ({ context }) => loadFinanceOverviewData(context.queryClient),
  head: () => ({
    meta: [{ title: 'Visão geral financeira | CalibraFácil' }],
  }),
  component: FinanceOverviewPage,
})
