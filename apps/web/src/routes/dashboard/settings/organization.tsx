import { createFileRoute } from '@tanstack/react-router'

import { validateOnboardingSearch } from '@/features/onboarding/search'

import { OrganizationSettingsRoute } from '@/features/settings/organization-page'

export const Route = createFileRoute('/dashboard/settings/organization')({
  validateSearch: validateOnboardingSearch,
  head: () => ({
    meta: [{ title: 'Organização | Configurações | CalibraFácil' }],
  }),
  component: OrganizationSettingsRoute,
})
