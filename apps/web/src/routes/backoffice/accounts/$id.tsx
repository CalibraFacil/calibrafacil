import { createFileRoute } from '@tanstack/react-router'

import { AccountProfilePage } from '@/features/backoffice/accounts/profile-page'

export const Route = createFileRoute('/backoffice/accounts/$id')({
  head: () => ({
    meta: [{ title: 'Conta | Backoffice | CalibraFácil' }],
  }),
  component: AccountProfileRoute,
})

function AccountProfileRoute() {
  const { id } = Route.useParams()
  return <AccountProfilePage id={id} />
}
