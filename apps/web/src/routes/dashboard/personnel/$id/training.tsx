import { createFileRoute } from '@tanstack/react-router'

import { TrainingTab } from '@/features/personnel/training-page'
import { loadCompetenceDetailData } from '@/features/personnel/queries'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/personnel/$id/training')({
  loader: ({ context, params }) =>
    loadCompetenceDetailData(context.queryClient, params.id),
  head: () => routeHead('/dashboard/personnel/$id/training'),
  component: TrainingRoute,
})

function TrainingRoute() {
  const { id } = Route.useParams()

  return <TrainingTab id={id} />
}
