import { createFileRoute } from '@tanstack/react-router'

import { FinanceContractDetailsPage } from '@/features/finance/contract-detail-page'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/finance/contracts/$id')({
  head: () => routeHead('/dashboard/finance/contracts/$id'),
  component: FinanceContractDetailsRoute,
})

function FinanceContractDetailsRoute() {
  const { id } = Route.useParams()

  return <FinanceContractDetailsPage id={id} />
}
