import {
  Outlet,
  createRootRouteWithContext,
  useLocation,
} from '@tanstack/react-router'
import { NuqsAdapter } from 'nuqs/adapters/tanstack-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { MotionConfig } from 'motion/react'
import { Analytics } from '@vercel/analytics/react'

import type { QueryClient } from '@tanstack/react-query'

import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import { usePrefersDark } from '@/hooks/use-prefers-dark'
import { OfflineBanner, SyncStatusProvider } from '@/runtime/sync-status'

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
  runtime: {
    isDesktop: boolean
  }
}>()({
  component: RootComponent,
})

function RootComponent() {
  const { queryClient, runtime } = Route.useRouteContext()
  // Landing follows the OS color scheme rather than the visitor's saved
  // dashboard theme. forcedTheme overrides the rendered class without
  // touching storage, so the dashboard's Appearance choice is preserved.
  const isLanding = useLocation({ select: (l) => l.pathname === '/' })
  const prefersDark = usePrefersDark()
  const landingTheme = prefersDark ? 'dark' : 'light'

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
        storageKey="theme"
        forcedTheme={isLanding ? landingTheme : undefined}
      >
        <MotionConfig reducedMotion="user">
          <SyncStatusProvider isDesktop={runtime.isDesktop}>
            <OfflineBanner />
            <NuqsAdapter>
              <Outlet />
            </NuqsAdapter>
          </SyncStatusProvider>
          {!runtime.isDesktop ? <Analytics /> : null}
          <Toaster richColors position="top-center" />
        </MotionConfig>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
