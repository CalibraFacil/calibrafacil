import { createFileRoute } from '@tanstack/react-router'

import { BillingSettingsPage } from './billing'

export const Route = createFileRoute('/dashboard/settings/subscription')({
  head: () => ({
    meta: [{ title: 'Assinatura | Configuracoes | CalibraFacil' }],
  }),
  component: BillingSettingsPage,
})
