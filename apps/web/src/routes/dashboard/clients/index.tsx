import { createFileRoute } from '@tanstack/react-router'

import { validateOnboardingSearch } from '@/features/onboarding/search'

import { ClientsPage } from '@/features/customers/list-page'
import { loadCustomersIndexData } from '@/features/customers/queries'
import { routeLocationToUrl } from '@/lib/route-data'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/clients/')({
  validateSearch: validateOnboardingSearch,
  loader: ({ context, location }) =>
    loadCustomersIndexData(context.queryClient, routeLocationToUrl(location)),
  head: () => routeHead('/dashboard/clients'),
  component: ClientsPageRoute,
})

/**
 * Thin adapter: the feature module never reads router state itself, so the
 * activation-checklist step arrives as a prop.
 */
function ClientsPageRoute() {
  const { onboarding } = Route.useSearch()

  return <ClientsPage onboardingStep={onboarding} />
}
