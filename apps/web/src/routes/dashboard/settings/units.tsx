import { createFileRoute } from '@tanstack/react-router'

import { OrganizationSettingsRoute } from '@/features/settings/organization-page'

export const Route = createFileRoute('/dashboard/settings/units')({
  head: () => ({
    meta: [{ title: 'Unidades & governança | Configurações | CalibraFácil' }],
  }),
  component: () => <OrganizationSettingsRoute section="units" />,
})
