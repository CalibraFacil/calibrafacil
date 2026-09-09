import { createFileRoute } from '@tanstack/react-router'
import { ClaimAccountPage } from '@/features/auth/claim-account-page'

type ClaimAccountSearch = {
  token?: string
  error?: string
  /** Plan picked on the pricing page, attached to the claim link by sign-up. */
  plano?: string
  ciclo?: 'MONTHLY' | 'YEARLY'
}

export const Route = createFileRoute('/claim-account')({
  validateSearch: (search: Record<string, unknown>): ClaimAccountSearch => ({
    token: typeof search.token === 'string' ? search.token : undefined,
    error: typeof search.error === 'string' ? search.error : undefined,
    plano: typeof search.plano === 'string' ? search.plano : undefined,
    ciclo:
      typeof search.ciclo === 'string' &&
      search.ciclo.toUpperCase() === 'MONTHLY'
        ? 'MONTHLY'
        : typeof search.ciclo === 'string'
          ? 'YEARLY'
          : undefined,
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

  return (
    <ClaimAccountPage
      token={search.token}
      error={search.error}
      plano={search.plano}
      ciclo={search.ciclo}
    />
  )
}
