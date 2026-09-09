import { createFileRoute } from '@tanstack/react-router'

import { validateOnboardingSearch } from '@/features/onboarding/search'
import { CertificatesSettingsPage } from '@/features/settings/certificates-page'

export const Route = createFileRoute('/dashboard/settings/certificates')({
  validateSearch: validateOnboardingSearch,
  head: () => ({
    meta: [{ title: 'Certificados ICP-Brasil | Configurações | CalibraFácil' }],
  }),
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
