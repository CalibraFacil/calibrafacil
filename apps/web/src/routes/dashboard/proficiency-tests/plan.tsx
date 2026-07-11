import { createFileRoute } from '@tanstack/react-router'

import { ProficiencyTestPlanPage } from '@/features/proficiency-tests/plan-page'

export const Route = createFileRoute('/dashboard/proficiency-tests/plan')({
  head: () => ({
    meta: [{ title: 'Plano de Participação EP | CalibraFacil' }],
  }),
  component: ProficiencyTestPlanPage,
})
