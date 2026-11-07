import { createFileRoute } from '@tanstack/react-router'

import { FinanceOverviewPage } from '@/features/finance/overview-page'
import { loadFinanceOverviewData } from '@/features/finance/queries'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/finance/')({
  loader: ({ context }) => loadFinanceOverviewData(context.queryClient),
  head: () => routeHead('/dashboard/finance'),
  component: FinanceOverviewPage,
})
