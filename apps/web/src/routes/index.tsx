import { createFileRoute, redirect } from '@tanstack/react-router'

import { LandingPage } from '@/features/public/landing-page'
import { hasDesktopSession } from '@/runtime/desktop-auth'
import { isDesktopRuntime } from '@/runtime/desktop'
import { isStandalonePwa } from '@/runtime/standalone'

export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    // Inside the installed PWA the marketing landing page is dead weight:
    // launching into '/' or swipe-navigating back to it should land on the
    // product (the dashboard guard bounces logged-out users to /sign-in).
    if (isStandalonePwa()) {
      throw redirect({ to: '/dashboard' })
    }

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
