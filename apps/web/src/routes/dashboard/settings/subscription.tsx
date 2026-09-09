import { createFileRoute } from '@tanstack/react-router'

import { BillingSettingsPage } from '@/features/settings/billing-page'

type SubscriptionSearch = {
  plano?: string
  ciclo?: 'MONTHLY' | 'YEARLY'
}

export const Route = createFileRoute('/dashboard/settings/subscription')({
  // A lab that signed up self-serve arrives here from the claim link with the
  // plan it picked on the pricing page still attached.
  validateSearch: (search: Record<string, unknown>): SubscriptionSearch => ({
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
    meta: [{ title: 'Assinatura | Configuracoes | CalibraFacil' }],
  }),
  component: SubscriptionRoute,
})

function SubscriptionRoute() {
  const { plano, ciclo } = Route.useSearch()
  return <BillingSettingsPage suggestedPlanId={plano} suggestedCycle={ciclo} />
}
