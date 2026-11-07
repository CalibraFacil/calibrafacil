import { createFileRoute } from '@tanstack/react-router'

import { SecuritySettingsPage } from '@/features/settings/security-page'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/settings/security')({
  head: () => routeHead('/dashboard/settings/security'),
  component: SecuritySettingsPage,
})
