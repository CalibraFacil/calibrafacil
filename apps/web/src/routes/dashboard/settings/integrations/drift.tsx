import { createFileRoute } from '@tanstack/react-router'

import { IntegrationDriftQueuePage } from '@/features/settings/integrations/drift-queue-page'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/settings/integrations/drift')({
  head: () => routeHead('/dashboard/settings/integrations/drift'),
  component: IntegrationDriftQueuePage,
})
