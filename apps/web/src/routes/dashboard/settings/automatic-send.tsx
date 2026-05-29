import { createFileRoute } from '@tanstack/react-router'

import { AutomaticSendSettingsPage } from '@/features/settings/automatic-send-page'

export const Route = createFileRoute('/dashboard/settings/automatic-send')({
  head: () => ({
    meta: [
      { title: 'Envio Automático | Configurações | CalibraFácil' },
    ],
  }),
  component: AutomaticSendSettingsPage,
})
