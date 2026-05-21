import { createFileRoute } from '@tanstack/react-router'

import { NewServicePage } from '@/features/services/new-page'
import { loadServiceFormOptions } from '@/features/services/queries'

export const Route = createFileRoute('/dashboard/services/new')({
  head: () => ({
    meta: [{ title: 'Novo Serviço | CalibraFácil' }],
  }),
  loader: ({ context }) => loadServiceFormOptions(context.queryClient),
  component: NewServicePage,
})
