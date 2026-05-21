import { createFileRoute } from '@tanstack/react-router'

import { ProfileSettingsPage } from '@/features/settings/profile-page'

export const Route = createFileRoute('/dashboard/settings/profile')({
  head: () => ({
    meta: [{ title: 'Perfil | Configurações | CalibraFácil' }],
  }),
  component: ProfileSettingsPage,
})
