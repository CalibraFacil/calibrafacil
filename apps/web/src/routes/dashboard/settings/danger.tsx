import { createFileRoute } from '@tanstack/react-router'

import { DangerSettingsPage } from '@/features/settings/danger-page'

export const Route = createFileRoute('/dashboard/settings/danger')({
  head: () => ({
    meta: [{ title: 'Zona de Perigo | Configurações | CalibraFácil' }],
  }),
  component: DangerSettingsPage,
})
