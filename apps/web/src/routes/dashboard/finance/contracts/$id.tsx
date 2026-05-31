import { createFileRoute } from '@tanstack/react-router'

import { FinanceContractDetailsPage } from '@/features/finance/contract-detail-page'

export const Route = createFileRoute('/dashboard/finance/contracts/$id')({
  head: () => ({
    meta: [{ title: 'Contrato comercial | CalibraFácil' }],
  }),
  component: FinanceContractDetailsRoute,
})

function FinanceContractDetailsRoute() {
  const { id } = Route.useParams()

  return <FinanceContractDetailsPage id={id} />
}
