import { createFileRoute } from '@tanstack/react-router'

import { EditMaterialPage } from '@/features/materials/edit-page'
import { loadMaterialEditData } from '@/features/materials/queries'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/materials/$id/edit')({
  head: () => routeHead('/dashboard/materials/$id/edit'),
  loader: ({ context, params }) =>
    loadMaterialEditData(context.queryClient, params.id),
  component: EditMaterialRoute,
})

function EditMaterialRoute() {
  const { id } = Route.useParams()

  return <EditMaterialPage id={id} />
}
