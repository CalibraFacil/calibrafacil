import { createFileRoute } from '@tanstack/react-router'

import { AppearanceSettingsPage } from '@/features/settings/appearance-page'

export const Route = createFileRoute('/dashboard/settings/appearance')({
  head: () => ({
    meta: [{ title: 'Aparência | Configurações | CalibraFácil' }],
  }),
  component: AppearanceSettingsPage,
})
