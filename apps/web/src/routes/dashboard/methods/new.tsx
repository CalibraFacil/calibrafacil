import { createFileRoute } from '@tanstack/react-router'

import { NewMethodPage } from '@/features/methods/new-page'

export const Route = createFileRoute('/dashboard/methods/new')({
  head: () => ({
    meta: [{ title: 'Novo Método | CalibraFacil' }],
  }),
  component: NewMethodPage,
})
