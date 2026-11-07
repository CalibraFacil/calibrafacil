import { createFileRoute } from '@tanstack/react-router'

import { validateOnboardingSearch } from '@/features/onboarding/search'

import { OrganizationSettingsRoute } from '@/features/settings/organization-page'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/settings/organization')({
  validateSearch: validateOnboardingSearch,
  head: () => routeHead('/dashboard/settings/organization'),
  component: OrganizationSettingsRoute,
})
