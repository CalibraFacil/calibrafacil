import { createFileRoute } from '@tanstack/react-router'

import { DangerSettingsPage } from '@/features/settings/danger-page'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/settings/danger')({
  head: () => routeHead('/dashboard/settings/danger'),
  component: DangerSettingsPage,
})
