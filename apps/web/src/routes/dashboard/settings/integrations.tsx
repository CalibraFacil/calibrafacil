import { createFileRoute } from '@tanstack/react-router'

import { IntegrationsSettingsPage } from '@/features/settings/integrations-page'

export const Route = createFileRoute('/dashboard/settings/integrations')({
  head: () => ({
    meta: [{ title: 'Integrações | Configurações | CalibraFácil' }],
  }),
  component: IntegrationsSettingsPage,
})
