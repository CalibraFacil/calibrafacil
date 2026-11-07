import { createFileRoute, redirect } from '@tanstack/react-router'

import {
  getDashboardRedirectTarget,
  routeHead,
} from '@/app/router/route-registry'
import { SettingsLayout } from '@/features/settings/layout'

export const Route = createFileRoute('/dashboard/settings')({
  beforeLoad: ({ location }) => {
    if (
      location.pathname === '/dashboard/settings' ||
      location.pathname === '/dashboard/settings/'
    ) {
      throw redirect({ to: getDashboardRedirectTarget('/dashboard/settings') })
    }
  },
  head: () =>
    routeHead('/dashboard/settings', [
      {
        name: 'description',
        content: 'Configurações da sua conta CalibraFácil',
      },
    ]),
  component: SettingsLayout,
})
