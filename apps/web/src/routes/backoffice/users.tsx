import { createFileRoute } from '@tanstack/react-router'

import { loadBackofficeUsersData } from '@/features/backoffice/queries'
import { BackofficeUsersPage } from '@/features/backoffice/users/users-page'

export const Route = createFileRoute('/backoffice/users')({
  validateSearch: (search: Record<string, unknown>) => ({
    impersonationError:
      typeof search.impersonationError === 'string'
        ? search.impersonationError
        : undefined,
  }),
  head: () => ({
    meta: [{ title: 'Equipe | Backoffice | CalibraFácil' }],
  }),
  loader: ({ context }) => loadBackofficeUsersData(context.queryClient),
  component: RouteComponent,
})

function RouteComponent() {
  const { impersonationError } = Route.useSearch()
  return <BackofficeUsersPage impersonationError={impersonationError} />
}
