import { createFileRoute } from '@tanstack/react-router'

import { AutomaticSendSettingsPage } from '@/features/settings/automatic-send-page'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/settings/automatic-send')({
  head: () => routeHead('/dashboard/settings/automatic-send'),
  component: AutomaticSendSettingsPage,
})
