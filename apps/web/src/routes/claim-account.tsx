import { createFileRoute } from '@tanstack/react-router'
import { ClaimAccountPage } from '@/features/auth/claim-account-page'

type ClaimAccountSearch = {
  token?: string
  error?: string
}

export const Route = createFileRoute('/claim-account')({
  validateSearch: (search: Record<string, unknown>): ClaimAccountSearch => ({
    token: typeof search.token === 'string' ? search.token : undefined,
    error: typeof search.error === 'string' ? search.error : undefined,
  }),
  head: () => ({
    meta: [
      {
        title: 'Configurar acesso | CalibraFácil',
        name: 'description',
        content: 'Configurar acesso ao dashboard CalibraFácil',
      },
    ],
  }),
  component: ClaimAccountRoute,
})

function ClaimAccountRoute() {
  const search = Route.useSearch()

  return <ClaimAccountPage token={search.token} error={search.error} />
}
