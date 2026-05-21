import { createFileRoute, redirect } from '@tanstack/react-router'

import { SettingsLayout } from '@/features/settings/layout'

export const Route = createFileRoute('/dashboard/settings')({
  beforeLoad: ({ location }) => {
    if (
      location.pathname === '/dashboard/settings' ||
      location.pathname === '/dashboard/settings/'
    ) {
      throw redirect({ to: '/dashboard/settings/profile' })
    }
  },
  head: () => ({
    meta: [
      {
        title: 'Configurações | CalibraFácil',
        name: 'description',
        content: 'Configurações da sua conta CalibraFácil',
      },
    ],
  }),
  component: SettingsLayout,
})
