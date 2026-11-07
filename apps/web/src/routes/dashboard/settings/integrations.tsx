import { createFileRoute } from '@tanstack/react-router'

import { IntegrationsSettingsPage } from '@/features/settings/integrations-page'
import {
  contaAzulOAuthErrorFromSearch,
  validateIntegrationsSearch,
} from '@/features/settings/integrations/search'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/settings/integrations')({
  head: () => routeHead('/dashboard/settings/integrations'),
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
