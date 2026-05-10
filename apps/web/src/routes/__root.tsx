import { Outlet, createRootRouteWithContext } from '@tanstack/react-router'
import { NuqsAdapter } from 'nuqs/adapters/tanstack-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { Analytics } from '@vercel/analytics/react'

import type { QueryClient } from '@tanstack/react-query'

import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from '@/components/ui/sonner'
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

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
        storageKey="theme"
      >
        <SyncStatusProvider isDesktop={runtime.isDesktop}>
          <OfflineBanner />
          <NuqsAdapter>
            <Outlet />
          </NuqsAdapter>
        </SyncStatusProvider>
        {!runtime.isDesktop ? <Analytics /> : null}
        <Toaster richColors position="top-center" />
      </ThemeProvider>
    </QueryClientProvider>
  )
}
