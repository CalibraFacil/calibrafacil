import {
  Outlet,
  createFileRoute,
  redirect,
  useLocation,
  useNavigate,
} from '@tanstack/react-router'

import {
  getBackofficeSession,
  useBackofficeSession,
} from '@calibra-facil/auth/client'
import { useBackofficeAccessData } from '@/features/backoffice/queries'
import { BackofficeHeader } from '@/components/backoffice-header'
import { BackofficeSidebar } from '@/components/backoffice-sidebar'
import { BackofficeCommandPaletteProvider } from '@/features/backoffice/command-palette/context'
import { BackofficeCommandPalette } from '@/features/backoffice/command-palette/palette'
import { Button } from '@/components/ui/button'
import { readSessionWithRetry } from '@/lib/auth-session'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'

export const Route = createFileRoute('/backoffice')({
  beforeLoad: async ({ location, preload }) => {
    if (preload) return

    if (location.pathname === '/backoffice/sign-in') {
      return
    }

    const { data: session } = await readSessionWithRetry(getBackofficeSession)

    if (!session) {
      throw redirect({
        to: '/backoffice/sign-in',
        search: { redirect: location.pathname },
      })
    }
  },
  component: BackofficeLayout,
})

function BackofficeLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const isAuthPage =
    location.pathname === '/backoffice/sign-in' ||
    location.pathname === '/backoffice/bootstrap'
  const { data: session } = useBackofficeSession()

  const accessQuery = useBackofficeAccessData({
    scope: 'layout',
    sessionKey: session?.session?.id,
    enabled: Boolean(session?.user) && !isAuthPage,
  })

  if (isAuthPage) {
    return <Outlet />
  }

  if (accessQuery.isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-md space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    )
  }

  if (!accessQuery.data?.allowed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Backoffice restrito</CardTitle>
            <CardDescription>
              Esta área é exclusiva para a operação interna da plataforma.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Button onClick={() => navigate({ to: '/dashboard' })}>
              Voltar ao dashboard
            </Button>
            <Button
              variant="outline"
              onClick={() => navigate({ to: '/backoffice/sign-in' })}
            >
              Entrar com outra conta
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <BackofficeCommandPaletteProvider>
      <SidebarProvider>
        <BackofficeSidebar />
        <SidebarInset>
          <BackofficeHeader />
          <main className="flex-1 p-4 sm:p-5">
            <Outlet />
          </main>
        </SidebarInset>
      </SidebarProvider>
      <BackofficeCommandPalette />
    </BackofficeCommandPaletteProvider>
  )
}
