import { createFileRoute } from '@tanstack/react-router'

import { SignatureSettingsPage } from '@/features/settings/signature-page'

export const Route = createFileRoute('/dashboard/settings/signature')({
  head: () => ({
    meta: [{ title: 'Assinatura | Configurações | CalibraFácil' }],
  }),
  component: SignatureSettingsPage,
})
