import { createFileRoute } from '@tanstack/react-router'

import { ProficiencyTestDetailPage } from '@/features/proficiency-tests/detail-page'

export const Route = createFileRoute('/dashboard/proficiency-tests/$id/')({
  head: () => ({
    meta: [{ title: 'Detalhes do Ensaio | CalibraFácil' }],
  }),
  component: ProficiencyTestDetailRoute,
})

function ProficiencyTestDetailRoute() {
  const { id } = Route.useParams()

  return <ProficiencyTestDetailPage id={id} />
}
