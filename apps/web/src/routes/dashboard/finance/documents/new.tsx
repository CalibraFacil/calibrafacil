import { createFileRoute } from '@tanstack/react-router'

import { NewFinanceDocumentPage } from '@/features/finance/new-document-page'

export const Route = createFileRoute('/dashboard/finance/documents/new')({
  head: () => ({
    meta: [{ title: 'Nova cobrança | CalibraFácil' }],
  }),
  component: NewFinanceDocumentPage,
})
