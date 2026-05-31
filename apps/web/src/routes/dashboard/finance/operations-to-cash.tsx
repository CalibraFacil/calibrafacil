import { createFileRoute } from '@tanstack/react-router'

import { OperationsToCashPage } from '@/features/finance/operations-to-cash-page'

export const Route = createFileRoute('/dashboard/finance/operations-to-cash')({
  head: () => ({
    meta: [{ title: 'Operação ao caixa | CalibraFácil' }],
  }),
  component: OperationsToCashPage,
})
