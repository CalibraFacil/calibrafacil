import { createFileRoute } from '@tanstack/react-router'

import { EditServicePage } from '@/features/services/edit-page'
import { loadServiceEditData } from '@/features/services/queries'

export const Route = createFileRoute('/dashboard/services/$id/edit')({
  head: () => ({
    meta: [{ title: 'Editar Serviço | CalibraFácil' }],
  }),
  loader: ({ context, params }) =>
    loadServiceEditData(context.queryClient, params.id),
  component: EditServiceRoute,
})

function EditServiceRoute() {
  const { id } = Route.useParams()

  return <EditServicePage id={id} />
}
