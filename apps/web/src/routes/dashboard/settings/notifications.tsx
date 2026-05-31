import { createFileRoute } from '@tanstack/react-router'

import { NotificationsSettingsPage } from '@/features/settings/notifications-page'

export const Route = createFileRoute('/dashboard/settings/notifications')({
  head: () => ({
    meta: [{ title: 'Notificações | Configurações | CalibraFácil' }],
  }),
  component: NotificationsSettingsPage,
})
