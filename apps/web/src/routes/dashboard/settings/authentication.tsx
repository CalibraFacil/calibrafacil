import { createFileRoute } from '@tanstack/react-router'

import { AuthenticationSettingsPage } from '@/features/settings/authentication-page'

export const Route = createFileRoute('/dashboard/settings/authentication')({
  head: () => ({
    meta: [{ title: 'Autenticação | Configurações | CalibraFácil' }],
  }),
  component: AuthenticationSettingsPage,
})
