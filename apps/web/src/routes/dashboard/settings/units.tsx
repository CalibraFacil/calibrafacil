import { createFileRoute } from '@tanstack/react-router'

import { OrganizationSettingsRoute } from '@/features/settings/organization-page'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/settings/units')({
  head: () => routeHead('/dashboard/settings/units'),
  component: () => <OrganizationSettingsRoute section="units" />,
})
