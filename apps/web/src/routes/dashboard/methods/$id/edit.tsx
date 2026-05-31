import { createFileRoute } from '@tanstack/react-router'

import { EditMethodPage } from '@/features/methods/edit-page'
import { loadMethodEditData } from '@/features/methods/queries'

export const Route = createFileRoute('/dashboard/methods/$id/edit')({
  loader: ({ context, params }) =>
    loadMethodEditData(context.queryClient, params.id),
  head: () => ({
    meta: [{ title: 'Editar Método | CalibraFácil' }],
  }),
  component: EditMethodRoute,
})

function EditMethodRoute() {
  const { id } = Route.useParams()

  return <EditMethodPage id={id} />
}
