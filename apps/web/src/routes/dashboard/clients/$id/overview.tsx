import { createFileRoute } from '@tanstack/react-router'

import { ClientOverviewTab } from '@/features/customers/overview-page'
import { loadCustomerOverviewData } from '@/features/customers/queries'

export const Route = createFileRoute('/dashboard/clients/$id/overview')({
  loader: ({ context, params }) =>
    loadCustomerOverviewData(context.queryClient, params.id),
  head: () => ({
    meta: [{ title: 'Cliente | Visão geral | CalibraFácil' }],
  }),
  component: ClientOverviewRoute,
})

function ClientOverviewRoute() {
  const { id } = Route.useParams()

  return <ClientOverviewTab id={id} />
}
