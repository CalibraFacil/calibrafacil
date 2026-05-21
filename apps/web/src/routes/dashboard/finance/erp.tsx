import { createFileRoute } from '@tanstack/react-router'

import { FinanceErpPage } from '@/features/finance/erp-page'
import { loadFinanceErpData } from '@/features/finance/queries'

export const Route = createFileRoute('/dashboard/finance/erp')({
  loader: ({ context }) => loadFinanceErpData(context.queryClient),
  head: () => ({
    meta: [{ title: 'ERP financeiro | CalibraFácil' }],
  }),
  component: FinanceErpPage,
})
