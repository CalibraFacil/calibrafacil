import { createFileRoute } from '@tanstack/react-router'

import { NewFinanceContractPage } from '@/features/finance/new-contract-page'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/finance/contracts/new')({
  head: () => routeHead('/dashboard/finance/contracts/new'),
  component: NewFinanceContractPage,
})
