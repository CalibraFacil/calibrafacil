import { createFileRoute } from '@tanstack/react-router'

import { EnvironmentSettingsPage } from '@/features/settings/environment-page'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/settings/environment')({
  head: () => routeHead('/dashboard/settings/environment'),
  component: EnvironmentSettingsPage,
})
