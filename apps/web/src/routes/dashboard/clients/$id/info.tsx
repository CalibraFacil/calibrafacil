import { createFileRoute } from '@tanstack/react-router'

import { ClientInfoTab } from '@/features/customers/info-page'
import { loadCustomerDetailData } from '@/features/customers/queries'
import { parseSyncConflictReturnSearch } from '@/runtime/sync-conflict-return'

export const Route = createFileRoute('/dashboard/clients/$id/info')({
  validateSearch: parseSyncConflictReturnSearch,
  loader: ({ context, params }) =>
    loadCustomerDetailData(context.queryClient, params.id),
  head: () => ({
    meta: [{ title: 'Cliente | Informações | CalibraFácil' }],
  }),
  component: ClientInfoRoute,
})

function ClientInfoRoute() {
  const { id } = Route.useParams()
  const conflictReturn = Route.useSearch()

  return <ClientInfoTab id={id} conflictReturn={conflictReturn} />
}
