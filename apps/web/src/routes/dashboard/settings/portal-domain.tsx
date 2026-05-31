import { createFileRoute } from '@tanstack/react-router'

import { PortalDomainSettingsPage } from '@/features/settings/portal-domain-page'

export const Route = createFileRoute('/dashboard/settings/portal-domain')({
  head: () => ({
    meta: [{ title: 'Portal Domain | Configurações | CalibraFácil' }],
  }),
  component: PortalDomainSettingsPage,
})
