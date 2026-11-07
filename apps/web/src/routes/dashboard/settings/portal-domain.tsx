import { createFileRoute } from '@tanstack/react-router'

import { PortalDomainSettingsPage } from '@/features/settings/portal-domain-page'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/settings/portal-domain')({
  head: () => routeHead('/dashboard/settings/portal-domain'),
  component: PortalDomainSettingsPage,
})
