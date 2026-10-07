import { createFileRoute } from '@tanstack/react-router'

import { IntegrationsSettingsPage } from '@/features/settings/integrations-page'
import {
  contaAzulOAuthErrorFromSearch,
  validateIntegrationsSearch,
} from '@/features/settings/integrations/search'

export const Route = createFileRoute('/dashboard/settings/integrations')({
  head: () => ({
    meta: [{ title: 'Integrações | Configurações | CalibraFácil' }],
  }),
  validateSearch: validateIntegrationsSearch,
  component: IntegrationsSettingsRoute,
})

function IntegrationsSettingsRoute() {
  const search = Route.useSearch()
  return (
    <IntegrationsSettingsPage
      contaAzulOAuthError={contaAzulOAuthErrorFromSearch(search)}
    />
  )
}
