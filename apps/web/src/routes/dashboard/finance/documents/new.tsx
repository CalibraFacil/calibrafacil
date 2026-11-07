import { createFileRoute } from '@tanstack/react-router'

import { NewFinanceDocumentPage } from '@/features/finance/new-document-page'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/finance/documents/new')({
  head: () => routeHead('/dashboard/finance/documents/new'),
  component: NewFinanceDocumentPage,
})
