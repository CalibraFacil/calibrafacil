import { createFileRoute } from '@tanstack/react-router'

import { NewStandardPage } from '@/features/standards/new-page'

export const Route = createFileRoute('/dashboard/standards/new')({
  head: () => ({
    meta: [{ title: 'Novo Padrão | CalibraFácil' }],
  }),
  component: NewStandardPage,
})
