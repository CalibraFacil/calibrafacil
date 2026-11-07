import { createFileRoute } from '@tanstack/react-router'

import { NotificationsSettingsPage } from '@/features/settings/notifications-page'
import { routeHead } from '@/app/router/route-registry'

export const Route = createFileRoute('/dashboard/settings/notifications')({
  head: () => routeHead('/dashboard/settings/notifications'),
  component: NotificationsSettingsPage,
})
