import { createFileRoute } from '@tanstack/react-router'

import { NewCompetencePage } from '@/features/personnel/new-page'
import { loadNewCompetenceData } from '@/features/personnel/queries'

export const Route = createFileRoute('/dashboard/personnel/new')({
  loader: ({ context }) => loadNewCompetenceData(context.queryClient),
  head: () => ({
    meta: [{ title: 'Nova Solicitação de Competência | CalibraFacil' }],
  }),
  component: NewCompetencePage,
})
