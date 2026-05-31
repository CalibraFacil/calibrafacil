import { createFileRoute } from '@tanstack/react-router'

import { NewFinanceContractPage } from '@/features/finance/new-contract-page'

export const Route = createFileRoute('/dashboard/finance/contracts/new')({
  head: () => ({
    meta: [{ title: 'Novo contrato comercial | CalibraFácil' }],
  }),
  component: NewFinanceContractPage,
})
