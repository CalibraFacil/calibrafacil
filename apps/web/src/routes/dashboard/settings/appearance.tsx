import { createFileRoute } from '@tanstack/react-router'

import { AppearanceSettingsPage } from '@/features/settings/appearance-page'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/settings/appearance')({
  head: () => routeHead('/dashboard/settings/appearance'),
  component: AppearanceSettingsPage,
})
