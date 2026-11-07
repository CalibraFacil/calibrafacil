import { createFileRoute } from '@tanstack/react-router'

import { EditMethodPage } from '@/features/methods/edit-page'
import { loadMethodEditData } from '@/features/methods/queries'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/methods/$id/edit')({
  loader: ({ context, params }) =>
    loadMethodEditData(context.queryClient, params.id),
  head: () => routeHead('/dashboard/methods/$id/edit'),
  component: EditMethodRoute,
})

function EditMethodRoute() {
  const { id } = Route.useParams()

  return <EditMethodPage id={id} />
}
