import { createFileRoute } from '@tanstack/react-router'

import { ServiceOrderDetailPage } from '@/features/service-orders/detail-page'
import { loadServiceOrderDetailData } from '@/features/service-orders/queries'
import { parseSyncConflictReturnSearch } from '@/runtime/sync-conflict-return'

export const Route = createFileRoute('/dashboard/service-orders/$publicId')({
  validateSearch: parseSyncConflictReturnSearch,
  loader: ({ context, params }) =>
    loadServiceOrderDetailData(context.queryClient, params.publicId),
  head: () => ({ meta: [{ title: 'Detalhe da OS | CalibraFácil' }] }),
  component: ServiceOrderDetailRoute,
})

function ServiceOrderDetailRoute() {
  const { publicId } = Route.useParams()
  const conflictReturn = Route.useSearch()

  return (
    <ServiceOrderDetailPage
      publicId={publicId}
      conflictReturn={conflictReturn}
    />
  )
}
