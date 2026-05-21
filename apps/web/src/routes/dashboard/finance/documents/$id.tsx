import { createFileRoute } from '@tanstack/react-router'

import { FinanceDocumentDetailsPage } from '@/features/finance/document-detail-page'

export const Route = createFileRoute('/dashboard/finance/documents/$id')({
  head: () => ({
    meta: [{ title: 'Documento financeiro | CalibraFácil' }],
  }),
  component: FinanceDocumentDetailsRoute,
})

function FinanceDocumentDetailsRoute() {
  const { id } = Route.useParams()

  return <FinanceDocumentDetailsPage id={id} />
}
