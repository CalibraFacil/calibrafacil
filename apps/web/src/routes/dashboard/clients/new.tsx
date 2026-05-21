import { createFileRoute } from '@tanstack/react-router'

import { NewClientPage } from '@/features/customers/new-page'

export const Route = createFileRoute('/dashboard/clients/new')({
  head: () => ({
    meta: [{ title: 'Novo Cliente | CalibraFácil' }],
  }),
  component: NewClientPage,
})
