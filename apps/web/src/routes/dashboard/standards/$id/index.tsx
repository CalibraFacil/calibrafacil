import { createFileRoute } from '@tanstack/react-router'

import { StandardDetailPage } from '@/features/standards/detail-page'
import { loadStandardDetailData } from '@/features/standards/queries'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/standards/$id/')({
  loader: ({ context, params }) =>
    loadStandardDetailData(context.queryClient, params.id),
  head: () => routeHead('/dashboard/standards/$id'),
  component: StandardDetailRoute,
})

function StandardDetailRoute() {
  const { id } = Route.useParams()

  return <StandardDetailPage id={id} />
}
