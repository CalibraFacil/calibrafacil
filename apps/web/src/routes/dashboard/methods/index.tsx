import { createFileRoute } from '@tanstack/react-router'

import { validateOnboardingSearch } from '@/features/onboarding/search'

import { MethodsListPage } from '@/features/methods/list-page'
import { loadMethodsIndexData } from '@/features/methods/queries'
import { routeLocationToUrl } from '@/lib/route-data'

export const Route = createFileRoute('/dashboard/methods/')({
  validateSearch: validateOnboardingSearch,
  loader: ({ context, location }) =>
    loadMethodsIndexData(context.queryClient, routeLocationToUrl(location)),
  head: () => ({
    meta: [{ title: 'Métodos de Calibração | CalibraFácil' }],
  }),
  component: MethodsListPageRoute,
})

/**
 * Thin adapter: the feature module never reads router state itself, so the
 * activation-checklist step arrives as a prop.
 */
function MethodsListPageRoute() {
  const { onboarding } = Route.useSearch()

  return <MethodsListPage onboardingStep={onboarding} />
}
