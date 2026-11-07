import { createFileRoute } from '@tanstack/react-router'

import { ServiceDetailPage } from '@/features/services/detail-page'
import { loadServiceDetailData } from '@/features/services/queries'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/services/$id/')({
  loader: ({ context, params }) =>
    loadServiceDetailData(context.queryClient, params.id),
  head: () => routeHead('/dashboard/services/$id'),
  component: ServiceDetailRoute,
})

function ServiceDetailRoute() {
  const { id } = Route.useParams()

  return <ServiceDetailPage id={id} />
}
