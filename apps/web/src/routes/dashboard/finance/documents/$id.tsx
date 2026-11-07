import { createFileRoute } from '@tanstack/react-router'

import { FinanceDocumentDetailsPage } from '@/features/finance/document-detail-page'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/finance/documents/$id')({
  head: () => routeHead('/dashboard/finance/documents/$id'),
  component: FinanceDocumentDetailsRoute,
})

function FinanceDocumentDetailsRoute() {
  const { id } = Route.useParams()

  return <FinanceDocumentDetailsPage id={id} />
}
