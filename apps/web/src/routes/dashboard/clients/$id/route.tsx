import { createFileRoute } from '@tanstack/react-router'

import { ClientDetailLayout } from '@/features/customers/detail-layout'
import { loadCustomerDetailData } from '@/features/customers/queries'

export const Route = createFileRoute('/dashboard/clients/$id')({
  loader: ({ context, params }) =>
    loadCustomerDetailData(context.queryClient, params.id),
  component: ClientDetailRoute,
})

function ClientDetailRoute() {
  const { id } = Route.useParams()

  return <ClientDetailLayout id={id} />
}
