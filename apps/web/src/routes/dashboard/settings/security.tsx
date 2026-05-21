import { createFileRoute } from '@tanstack/react-router'

import { SecuritySettingsPage } from '@/features/settings/security-page'

export const Route = createFileRoute('/dashboard/settings/security')({
  head: () => ({
    meta: [{ title: 'Segurança | Configurações | CalibraFácil' }],
  }),
  component: SecuritySettingsPage,
})
