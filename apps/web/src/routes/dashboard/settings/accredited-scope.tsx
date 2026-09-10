import { createFileRoute } from '@tanstack/react-router'
import { AccreditedScopeSettingsPage } from '@/features/settings/accredited-scope-page'

export const Route = createFileRoute('/dashboard/settings/accredited-scope')({
  head: () => ({
    meta: [{ title: 'Escopo Acreditado (CMC) | Configurações | CalibraFácil' }],
  }),
  component: AccreditedScopeSettingsPage,
})
