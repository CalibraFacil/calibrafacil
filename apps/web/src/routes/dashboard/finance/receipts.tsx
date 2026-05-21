import { createFileRoute } from '@tanstack/react-router'

import { FinanceReceiptsPage } from '@/features/finance/receipts-page'
import { loadFinanceReceiptsData } from '@/features/finance/queries'

export const Route = createFileRoute('/dashboard/finance/receipts')({
  loader: ({ context }) => loadFinanceReceiptsData(context.queryClient),
  head: () => ({
    meta: [{ title: 'Recebimentos | CalibraFácil' }],
  }),
  component: FinanceReceiptsPage,
})
