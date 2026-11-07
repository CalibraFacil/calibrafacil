import { createFileRoute } from '@tanstack/react-router'

import { ServiceOrderDetailPage } from '@/features/service-orders/detail-page'
import { loadServiceOrderDetailData } from '@/features/service-orders/queries'
import { parseSyncConflictReturnSearch } from '@/runtime/sync-conflict-return'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/service-orders/$publicId')({
  validateSearch: parseSyncConflictReturnSearch,
  loader: ({ context, params }) =>
    loadServiceOrderDetailData(context.queryClient, params.publicId),
  head: () => routeHead('/dashboard/service-orders/$publicId'),
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
