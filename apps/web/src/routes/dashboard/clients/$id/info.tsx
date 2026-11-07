import { createFileRoute } from '@tanstack/react-router'

import { ClientInfoTab } from '@/features/customers/info-page'
import { loadCustomerDetailData } from '@/features/customers/queries'
import { parseSyncConflictReturnSearch } from '@/runtime/sync-conflict-return'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/clients/$id/info')({
  validateSearch: parseSyncConflictReturnSearch,
  loader: ({ context, params }) =>
    loadCustomerDetailData(context.queryClient, params.id),
  head: () => routeHead('/dashboard/clients/$id/info'),
  component: ClientInfoRoute,
})

function ClientInfoRoute() {
  const { id } = Route.useParams()
  const conflictReturn = Route.useSearch()

  return <ClientInfoTab id={id} conflictReturn={conflictReturn} />
}
