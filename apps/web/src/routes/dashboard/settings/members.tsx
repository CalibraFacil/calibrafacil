import { createFileRoute } from '@tanstack/react-router'

import { OrganizationSettingsRoute } from '@/features/settings/organization-page'

export const Route = createFileRoute('/dashboard/settings/members')({
  head: () => ({
    meta: [{ title: 'Membros & convites | Configurações | CalibraFácil' }],
  }),
  component: () => <OrganizationSettingsRoute section="members" />,
})
