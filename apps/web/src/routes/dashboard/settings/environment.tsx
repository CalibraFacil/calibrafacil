import { createFileRoute } from '@tanstack/react-router'

import { EnvironmentSettingsPage } from '@/features/settings/environment-page'

export const Route = createFileRoute('/dashboard/settings/environment')({
  head: () => ({
    meta: [{ title: 'Condições Ambientais | Configurações | CalibraFácil' }],
  }),
  component: EnvironmentSettingsPage,
})
