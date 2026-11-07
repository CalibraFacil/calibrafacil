import { createFileRoute } from '@tanstack/react-router'

import { NewCompetencePage } from '@/features/personnel/new-page'
import { loadNewCompetenceData } from '@/features/personnel/queries'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/personnel/new')({
  loader: ({ context }) => loadNewCompetenceData(context.queryClient),
  head: () => routeHead('/dashboard/personnel/new'),
  component: NewCompetencePage,
})
