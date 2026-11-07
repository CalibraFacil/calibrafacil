import { createFileRoute } from '@tanstack/react-router'
import { AccreditedScopeSettingsPage } from '@/features/settings/accredited-scope-page'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/settings/accredited-scope')({
  head: () => routeHead('/dashboard/settings/accredited-scope'),
  component: AccreditedScopeSettingsPage,
})
