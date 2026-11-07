import { createFileRoute } from '@tanstack/react-router'

import { AuthenticationSettingsPage } from '@/features/settings/authentication-page'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/settings/authentication')({
  head: () => routeHead('/dashboard/settings/authentication'),
  component: AuthenticationSettingsPage,
})
