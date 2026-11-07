import { createFileRoute } from '@tanstack/react-router'

import { EditServicePage } from '@/features/services/edit-page'
import { loadServiceEditData } from '@/features/services/queries'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/services/$id/edit')({
  head: () => routeHead('/dashboard/services/$id/edit'),
  loader: ({ context, params }) =>
    loadServiceEditData(context.queryClient, params.id),
  component: EditServiceRoute,
})

function EditServiceRoute() {
  const { id } = Route.useParams()

  return <EditServicePage id={id} />
}
