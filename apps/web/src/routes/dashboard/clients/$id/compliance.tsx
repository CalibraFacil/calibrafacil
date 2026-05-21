import { createFileRoute } from '@tanstack/react-router'

import { ClientComplianceTab } from '@/features/customers/compliance-page'
import { loadCustomerComplianceData } from '@/features/customers/queries'

export const Route = createFileRoute('/dashboard/clients/$id/compliance')({
  loader: ({ context, params }) =>
    loadCustomerComplianceData(context.queryClient, params.id),
  head: () => ({
    meta: [{ title: 'Cliente | Compliance | CalibraFácil' }],
  }),
  component: ClientComplianceRoute,
})

function ClientComplianceRoute() {
  const { id } = Route.useParams()

  return <ClientComplianceTab id={id} />
}
