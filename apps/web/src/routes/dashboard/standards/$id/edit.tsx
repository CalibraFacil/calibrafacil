import { createFileRoute } from '@tanstack/react-router'

import { EditStandardPage } from '@/features/standards/edit-page'
import { loadStandardDetailData } from '@/features/standards/queries'

export const Route = createFileRoute('/dashboard/standards/$id/edit')({
  head: () => ({
    meta: [{ title: 'Editar Padrão | CalibraFácil' }],
  }),
  loader: ({ context, params }) =>
    loadStandardDetailData(context.queryClient, params.id),
  component: EditStandardRoute,
})

function EditStandardRoute() {
  const { id } = Route.useParams()

  return <EditStandardPage id={id} />
}
