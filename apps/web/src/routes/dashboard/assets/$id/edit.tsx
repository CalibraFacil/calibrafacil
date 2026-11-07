import { createFileRoute } from '@tanstack/react-router'

import { EditAssetPage } from '@/features/assets/edit-page'
import { loadAssetEditData } from '@/features/assets/queries'
import { parseSyncConflictReturnSearch } from '@/runtime/sync-conflict-return'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/assets/$id/edit')({
  loader: ({ context, params }) =>
    loadAssetEditData(context.queryClient, params.id),
  validateSearch: parseSyncConflictReturnSearch,
  head: () => routeHead('/dashboard/assets/$id/edit'),
  component: EditAssetRoute,
})

function EditAssetRoute() {
  const { id } = Route.useParams()
  const conflictReturn = Route.useSearch()

  return <EditAssetPage id={id} conflictReturn={conflictReturn} />
}
