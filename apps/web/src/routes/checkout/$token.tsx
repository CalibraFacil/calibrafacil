import { createFileRoute } from '@tanstack/react-router'

import {
  PublicCheckoutPage,
  type ProviderOutcome,
} from '@/features/public/checkout-page'

type CheckoutSearch = {
  providerOutcome?: ProviderOutcome
}

export const Route = createFileRoute('/checkout/$token')({
  validateSearch: (search: Record<string, unknown>): CheckoutSearch => ({
    providerOutcome:
      search.providerOutcome === 'success' ||
      search.providerOutcome === 'cancel' ||
      search.providerOutcome === 'expired'
        ? search.providerOutcome
        : undefined,
  }),
  head: () => ({
    meta: [
      { title: 'Pagamento | CalibraFácil' },
      { name: 'robots', content: 'noindex,nofollow' },
    ],
  }),
  component: CheckoutRoute,
})

function CheckoutRoute() {
  const { token } = Route.useParams()
  const { providerOutcome } = Route.useSearch()
  return <PublicCheckoutPage token={token} providerOutcome={providerOutcome} />
}
