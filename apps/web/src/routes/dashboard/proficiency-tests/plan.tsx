import { createFileRoute } from '@tanstack/react-router'

import { ProficiencyTestPlanPage } from '@/features/proficiency-tests/plan-page'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/proficiency-tests/plan')({
  head: () => routeHead('/dashboard/proficiency-tests/plan'),
  component: ProficiencyTestPlanPage,
})
