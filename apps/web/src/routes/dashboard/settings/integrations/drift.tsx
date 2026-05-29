import { createFileRoute } from '@tanstack/react-router'

import { IntegrationDriftQueuePage } from '@/features/settings/integrations/drift-queue-page'

export const Route = createFileRoute(
  '/dashboard/settings/integrations/drift',
)({
  head: () => ({
    meta: [
      { title: 'Divergências de Integração | Configurações | CalibraFácil' },
    ],
  }),
  component: IntegrationDriftQueuePage,
})
