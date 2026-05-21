import { createFileRoute } from '@tanstack/react-router'

import { ServiceOrderDetailPage } from '@/features/service-orders/detail-page'
import { loadServiceOrderDetailData } from '@/features/service-orders/queries'
import { parseSyncConflictReturnSearch } from '@/runtime/sync-conflict-return'

export const Route = createFileRoute('/dashboard/service-orders/$id')({
  validateSearch: parseSyncConflictReturnSearch,
  loader: ({ context, params }) =>
    loadServiceOrderDetailData(context.queryClient, params.id),
  head: () => ({ meta: [{ title: 'Detalhe da OS | CalibraFácil' }] }),
  component: ServiceOrderDetailRoute,
})

function ServiceOrderDetailRoute() {
  const { id } = Route.useParams()
  const conflictReturn = Route.useSearch()

  return <ServiceOrderDetailPage id={id} conflictReturn={conflictReturn} />
}
