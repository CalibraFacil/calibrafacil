import { createFileRoute } from '@tanstack/react-router'

import { MethodDetailPage } from '@/features/methods/detail-page'
import { loadMethodDetailData } from '@/features/methods/queries'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/methods/$id/')({
  loader: ({ context, params }) =>
    loadMethodDetailData(context.queryClient, params.id),
  head: () => routeHead('/dashboard/methods/$id'),
  component: MethodDetailRoute,
})

function MethodDetailRoute() {
  const { id } = Route.useParams()

  return <MethodDetailPage id={id} />
}
