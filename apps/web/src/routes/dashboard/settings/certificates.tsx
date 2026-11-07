import { createFileRoute } from '@tanstack/react-router'

import { validateOnboardingSearch } from '@/features/onboarding/search'
import { CertificatesSettingsPage } from '@/features/settings/certificates-page'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/settings/certificates')({
  validateSearch: validateOnboardingSearch,
  head: () => routeHead('/dashboard/settings/certificates'),
  component: CertificatesSettingsPageRoute,
})

/**
 * Thin adapter: the feature module never reads router state itself, so the
 * activation-checklist step arrives as a prop.
 */
function CertificatesSettingsPageRoute() {
  const { onboarding } = Route.useSearch()

  return <CertificatesSettingsPage onboardingStep={onboarding} />
}
