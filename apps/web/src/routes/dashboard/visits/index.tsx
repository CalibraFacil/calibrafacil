import { createFileRoute } from '@tanstack/react-router'

import { VisitsPage } from '@/features/visits/list-page'

export const Route = createFileRoute('/dashboard/visits/')({
  head: () => ({
    meta: [{ title: 'Visitas | CalibraFácil' }],
  }),
  component: VisitsPage,
})
