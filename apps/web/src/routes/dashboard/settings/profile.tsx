import { createFileRoute } from '@tanstack/react-router'

import { ProfileSettingsPage } from '@/features/settings/profile-page'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/settings/profile')({
  head: () => routeHead('/dashboard/settings/profile'),
  component: ProfileSettingsPage,
})
