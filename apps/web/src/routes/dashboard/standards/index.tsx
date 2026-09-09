import { createFileRoute } from '@tanstack/react-router'

import { validateOnboardingSearch } from '@/features/onboarding/search'

import { StandardsListPage } from '@/features/standards/list-page'
import { loadStandardsIndexData } from '@/features/standards/queries'
import { routeLocationToUrl } from '@/lib/route-data'

export const Route = createFileRoute('/dashboard/standards/')({
  validateSearch: validateOnboardingSearch,
  loader: ({ context, location }) =>
    loadStandardsIndexData(context.queryClient, routeLocationToUrl(location)),
  head: () => ({
    meta: [{ title: 'Padroes de Referencia | CalibraFacil' }],
  }),
  component: StandardsListPageRoute,
})

/**
 * Thin adapter: the feature module never reads router state itself, so the
 * activation-checklist step arrives as a prop.
 */
function StandardsListPageRoute() {
  const { onboarding } = Route.useSearch()

  return <StandardsListPage onboardingStep={onboarding} />
}
