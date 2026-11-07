import { createFileRoute } from '@tanstack/react-router'

import { ProficiencyTestDetailPage } from '@/features/proficiency-tests/detail-page'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/proficiency-tests/$id/')({
  head: () => routeHead('/dashboard/proficiency-tests/$id'),
  component: ProficiencyTestDetailRoute,
})

function ProficiencyTestDetailRoute() {
  const { id } = Route.useParams()

  return <ProficiencyTestDetailPage id={id} />
}
