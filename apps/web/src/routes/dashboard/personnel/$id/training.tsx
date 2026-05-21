import { createFileRoute } from '@tanstack/react-router'

import { TrainingTab } from '@/features/personnel/training-page'
import { loadCompetenceDetailData } from '@/features/personnel/queries'

export const Route = createFileRoute('/dashboard/personnel/$id/training')({
  loader: ({ context, params }) =>
    loadCompetenceDetailData(context.queryClient, params.id),
  head: () => ({
    meta: [{ title: 'Treinamentos | CalibraFacil' }],
  }),
  component: TrainingRoute,
})

function TrainingRoute() {
  const { id } = Route.useParams()

  return <TrainingTab id={id} />
}
