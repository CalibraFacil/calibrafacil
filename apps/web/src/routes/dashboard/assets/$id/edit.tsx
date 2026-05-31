import { createFileRoute } from '@tanstack/react-router'

import { EditAssetPage } from '@/features/assets/edit-page'
import { loadAssetEditData } from '@/features/assets/queries'
import { parseSyncConflictReturnSearch } from '@/runtime/sync-conflict-return'

export const Route = createFileRoute('/dashboard/assets/$id/edit')({
  loader: ({ context, params }) =>
    loadAssetEditData(context.queryClient, params.id),
  validateSearch: parseSyncConflictReturnSearch,
  head: () => ({
    meta: [{ title: 'Editar Ativo | CalibraFácil' }],
  }),
  component: EditAssetRoute,
})

function EditAssetRoute() {
  const { id } = Route.useParams()
  const conflictReturn = Route.useSearch()

  return <EditAssetPage id={id} conflictReturn={conflictReturn} />
}
