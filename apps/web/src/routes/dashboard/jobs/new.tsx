import { createFileRoute } from '@tanstack/react-router'

import { NewJobPage } from '@/features/jobs/new-page'

export const Route = createFileRoute('/dashboard/jobs/new')({
  head: () => ({
    meta: [{ title: 'Nova Calibração | CalibraFacil' }],
  }),
  component: NewJobPage,
})
