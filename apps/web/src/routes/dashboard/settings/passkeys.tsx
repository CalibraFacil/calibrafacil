import { createFileRoute } from '@tanstack/react-router'

import { PasskeysSettingsPage } from '@/features/passkeys/passkeys-page'

export const Route = createFileRoute('/dashboard/settings/passkeys')({
  head: () => ({
    meta: [{ title: 'Passkeys | Configurações | CalibraFácil' }],
  }),
  component: PasskeysSettingsPage,
})
