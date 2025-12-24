import {
  HeadContent,
  Outlet,
  ScriptOnce,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/react-router'

import { QueryClientProvider } from '@tanstack/react-query'
import appCss from '../styles.css?url'

import type { QueryClient } from '@tanstack/react-query'

import { Toaster } from '@/components/ui/sonner'

// Inline script to apply theme before React hydrates (prevents flicker)
const themeScript = `
(function() {
  try {
    var stored = localStorage.getItem('portal-theme');
    var theme = stored === 'dark' || stored === 'light' ? stored : null;

    if (!theme) {
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    document.documentElement.classList.add(theme);
  } catch (e) {
    document.documentElement.classList.add('light');
  }
})();
`

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
}>()({
  ssr: false,
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'CalibraFácil | Portal do Cliente' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  component: RootComponent,
})

function RootComponent() {
  const { queryClient } = Route.useRouteContext()

  return (
    <RootDocument>
      <QueryClientProvider client={queryClient}>
        <Outlet />
      </QueryClientProvider>
    </RootDocument>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-br" suppressHydrationWarning>
      <head>
        <ScriptOnce>{themeScript}</ScriptOnce>
        <HeadContent />
      </head>
      <body>
        {children}
        <Toaster richColors position="top-center" />
        <Scripts />
      </body>
    </html>
  )
}
