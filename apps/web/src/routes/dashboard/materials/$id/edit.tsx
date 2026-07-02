import { createFileRoute } from '@tanstack/react-router'

import { EditMaterialPage } from '@/features/materials/edit-page'
import { loadMaterialEditData } from '@/features/materials/queries'

export const Route = createFileRoute('/dashboard/materials/$id/edit')({
  head: () => ({
    meta: [{ title: 'Editar Material | CalibraFácil' }],
  }),
  loader: ({ context, params }) =>
    loadMaterialEditData(context.queryClient, params.id),
  component: EditMaterialRoute,
})

function EditMaterialRoute() {
  const { id } = Route.useParams()

  return <EditMaterialPage id={id} />
}
