import { createFileRoute, redirect } from '@tanstack/react-router'

import { LandingPage } from '@/features/public/landing-page'
import { hasDesktopSession } from '@/runtime/desktop-auth'
import { isDesktopRuntime } from '@/runtime/desktop'

export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    if (!isDesktopRuntime()) return

    if (await hasDesktopSession()) {
      throw redirect({ to: '/dashboard' })
    }

    throw redirect({
      to: '/sign-in',
      search: { redirect: '/dashboard' },
    })
  },
  head: () => ({
    meta: [
      {
        title: 'CalibraFácil — Gestão metrológica para laboratórios e oficinas',
      },
      {
        name: 'description',
        content:
          'Sistema de gestão para laboratórios de calibração acreditados e oficinas permissionárias do Inmetro: fluxo de aprovação, memorial de incerteza conforme o GUM, certificados e portal do cliente.',
      },
    ],
  }),
  component: LandingPage,
})
