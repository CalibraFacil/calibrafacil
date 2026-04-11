import { createFileRoute } from '@tanstack/react-router'

import { useBackofficeSession } from '@calibra-facil/auth/client'
import { AccountWorkspace } from '../-customer-success/account-workspace'

export const Route = createFileRoute(
  '/backoffice/customer-success/accounts/$id',
)({
  head: () => ({
    meta: [{ title: 'Customer Success | Conta | CalibraFácil' }],
  }),
  component: CustomerSuccessAccountPage,
})

function CustomerSuccessAccountPage() {
  const { id } = Route.useParams()
  const { data: session } = useBackofficeSession()

  return (
    <AccountWorkspace organizationId={id} sessionUserId={session?.user?.id} />
  )
}
