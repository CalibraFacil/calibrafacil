import { createFileRoute } from '@tanstack/react-router'

import { OrganizationSettingsRoute } from '@/features/settings/organization-page'

export const Route = createFileRoute('/dashboard/settings/organization')({
  head: () => ({
    meta: [{ title: 'Organização | Configurações | CalibraFácil' }],
  }),
  component: OrganizationSettingsRoute,
})
