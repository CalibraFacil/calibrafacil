import { createFileRoute } from '@tanstack/react-router'

import { EditStandardPage } from '@/features/standards/edit-page'
import { loadStandardDetailData } from '@/features/standards/queries'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/standards/$id/edit')({
  head: () => routeHead('/dashboard/standards/$id/edit'),
  loader: ({ context, params }) =>
    loadStandardDetailData(context.queryClient, params.id),
  component: EditStandardRoute,
})

function EditStandardRoute() {
  const { id } = Route.useParams()

  return <EditStandardPage id={id} />
}
