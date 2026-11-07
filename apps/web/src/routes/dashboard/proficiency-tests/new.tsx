import { createFileRoute } from '@tanstack/react-router'

import { NewProficiencyTestPage } from '@/features/proficiency-tests/new-page'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/proficiency-tests/new')({
  head: () => routeHead('/dashboard/proficiency-tests/new'),
  component: NewProficiencyTestPage,
})
