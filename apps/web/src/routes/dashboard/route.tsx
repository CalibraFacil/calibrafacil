import {
  Outlet,
  createFileRoute,
  redirect,
  useLocation,
  useNavigate,
} from '@tanstack/react-router'

import {
  organization,
  useActiveOrganization,
  useListOrganizations,
} from '@calibra-facil/auth/client'
import { canAccessBackoffice } from '@calibra-facil/auth/access'
import { AppSidebar } from '@/components/app-sidebar'
import { CommandPalette } from '@/components/command-palette/command-palette'
import { CommandPaletteProvider } from '@/components/command-palette/command-context'
import { DashboardHeader } from '@/components/dashboard-header'
import { UnitScopeBanner } from '@/components/unit-scope-banner'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { authClient } from '@calibra-facil/auth/client'
import {
  DashboardContextStateContext,
  useDashboardContextState,
} from '@/contexts/dashboard-context'
import { useMountEffect } from '@/hooks/use-mount-effect'
import { hasDesktopSession } from '@/runtime/desktop-auth'
import { isDesktopRuntime } from '@/runtime/desktop'
import {
  CloudOnlyOfflineState,
  useDesktopCloudOnlyUnavailable,
} from '@/runtime/sync-status'
import { isCloudOnlyDashboardPath } from '@/runtime/cloud-only-routes'

export { useDashboardContextState }

const DASHBOARD_ORG_KEY = 'dashboard-active-org'
const DASHBOARD_LAYOUT_MOUNT_MARK = 'dashboard:layout:mount'
const DASHBOARD_LAYOUT_READY_MARK = 'dashboard:layout:ready'
const DASHBOARD_CONTEXT_START_MARK = 'dashboard:context:start'
const DASHBOARD_CONTEXT_END_MARK = 'dashboard:context:end'
const DASHBOARD_SESSION_CACHE_MS = 30_000

type DashboardSessionResult = Awaited<ReturnType<typeof authClient.getSession>>

let dashboardSessionPromise: ReturnType<typeof authClient.getSession> | null =
  null
let dashboardSessionCache: {
  expiresAt: number
  result: DashboardSessionResult
} | null = null
const activeOrganizationSwitches = new Set<string>()

function mark(name: string) {
  if (typeof window === 'undefined' || !window.performance) return
  window.performance.mark(name)
}

function measure(name: string, startMark: string, endMark: string) {
  if (typeof window === 'undefined' || !window.performance) return

  try {
    window.performance.measure(name, startMark, endMark)
  } catch {
    // no-op: marks may not exist in edge navigation cases
  }
}

export const Route = createFileRoute('/dashboard')({
  beforeLoad: async ({ location, preload }) => {
    if (preload) return

    if (isDesktopRuntime()) {
      if (await hasDesktopSession()) return

      throw redirect({
        to: '/sign-in',
        search: { redirect: location.pathname },
      })
    }

    const { data: session } = await getDashboardSession()

    if (!session) {
      throw redirect({
        to: '/sign-in',
        search: { redirect: location.pathname },
      })
    }

    if (
      canAccessBackoffice(session.user.role) &&
      !session.session.impersonatedBy
    ) {
      throw redirect({ to: '/backoffice' })
    }
  },
  component: DashboardLayout,
})

async function getDashboardSession() {
  if (dashboardSessionCache && dashboardSessionCache.expiresAt > Date.now()) {
    return dashboardSessionCache.result
  }

  dashboardSessionPromise ??= authClient
    .getSession()
    .then((result) => {
      dashboardSessionCache = {
        expiresAt: Date.now() + DASHBOARD_SESSION_CACHE_MS,
        result,
      }
      return result
    })
    .finally(() => {
      dashboardSessionPromise = null
    })

  return dashboardSessionPromise
}

function DashboardLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const cloudOnlyUnavailable = useDesktopCloudOnlyUnavailable()
  const { data: organizations, isPending: organizationsLoading } =
    useListOrganizations()
  const { data: activeOrg, isPending: activeOrgLoading } =
    useActiveOrganization()

  // Check if user has any LAB organizations
  // The 'type' field is a direct column on organization table (not in metadata)
  const labOrganizations =
    organizations?.filter((org) => org.type !== 'CLIENT') ?? []
  const storedOrgId =
    typeof window !== 'undefined'
      ? window.localStorage.getItem(DASHBOARD_ORG_KEY)
      : null
  const storedLabOrg = storedOrgId
    ? (labOrganizations.find((org) => org.id === storedOrgId) ?? null)
    : null
  const activeLabOrg =
    activeOrg?.type !== 'CLIENT'
      ? (labOrganizations.find((org) => org.id === activeOrg?.id) ?? null)
      : null

  const pathname = location.pathname
  const isDashboardHome =
    pathname === '/dashboard' || pathname === '/dashboard/'
  const hasLabAccess = labOrganizations.length > 0
  const hasAnyOrganizations = (organizations?.length ?? 0) > 0
  const hasLoadedOrganizations = !organizationsLoading
  const preferredDashboardOrg =
    storedLabOrg ?? activeLabOrg ?? labOrganizations[0] ?? null
  const needsDashboardOrgSwitch =
    hasLoadedOrganizations &&
    !activeOrgLoading &&
    hasLabAccess &&
    Boolean(preferredDashboardOrg) &&
    activeOrg?.id !== preferredDashboardOrg?.id
  const isBootstrappingContext =
    !hasLoadedOrganizations || activeOrgLoading || needsDashboardOrgSwitch
  const isContextSwitching = isBootstrappingContext
  const shouldBlockChildRoutes = !isDashboardHome && isContextSwitching
  const shouldBlockCloudOnlyRoute =
    !shouldBlockChildRoutes &&
    cloudOnlyUnavailable &&
    isCloudOnlyDashboardPath(pathname)
  const effectiveActiveOrganizationId = activeLabOrg?.id ?? null

  // No LAB access but no organizations yet - send to onboarding
  if (!isBootstrappingContext && !hasLabAccess && !hasAnyOrganizations) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Complete o onboarding</CardTitle>
            <CardDescription>
              Sua conta foi criada, mas você ainda não configurou um laboratório
              para acessar o dashboard.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Button
              onClick={() => navigate({ to: '/onboarding/organization' })}
            >
              Criar laboratório
            </Button>
            <Button variant="outline" onClick={() => navigate({ to: '/' })}>
              Voltar para o início
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  // No LAB access - show restricted page for portal-only users
  if (!isBootstrappingContext && !hasLabAccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Acesso Restrito</CardTitle>
            <CardDescription>
              Esta área é exclusiva para usuários do laboratório. Se você é um
              cliente, acesse o Portal do Cliente.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Button
              onClick={() => {
                // Redirect to portal
                const host = window.location.hostname
                window.location.href = `${window.location.protocol}//${host}:5174`
              }}
            >
              Acessar Portal do Cliente
            </Button>
            <Button variant="outline" onClick={() => navigate({ to: '/' })}>
              Voltar para o início
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <DashboardContextStateContext.Provider
      value={{
        isContextSwitching,
        activeOrganizationId: effectiveActiveOrganizationId,
      }}
    >
      <DashboardLayoutMountMarker />
      {preferredDashboardOrg ? (
        <PersistDashboardOrgSelection
          key={`persist-${preferredDashboardOrg.id}`}
          organizationId={preferredDashboardOrg.id}
        />
      ) : null}
      {needsDashboardOrgSwitch && preferredDashboardOrg ? (
        <DashboardOrgSwitcher
          key={`switch-${preferredDashboardOrg.id}`}
          organizationId={preferredDashboardOrg.id}
        />
      ) : null}
      {!isContextSwitching ? <DashboardReadyMarker /> : null}
      <CommandPaletteProvider>
        <SidebarProvider>
          <AppSidebar />
          <SidebarInset>
            <DashboardHeader suspendEntityQueries={isContextSwitching} />
            <main className="flex-1 space-y-4 p-4">
              <UnitScopeBanner />
              {shouldBlockChildRoutes ? (
                <div className="space-y-4">
                  <div className="h-10 w-56 rounded-md border bg-card/60 animate-pulse" />
                  <div className="h-64 rounded-lg border bg-card/60 animate-pulse" />
                </div>
              ) : shouldBlockCloudOnlyRoute ? (
                <CloudOnlyOfflineState title="Tela indisponível offline" />
              ) : (
                <Outlet />
              )}
            </main>
          </SidebarInset>
        </SidebarProvider>
        <CommandPalette />
      </CommandPaletteProvider>
    </DashboardContextStateContext.Provider>
  )
}

function DashboardLayoutMountMarker() {
  useMountEffect(() => {
    mark(DASHBOARD_LAYOUT_MOUNT_MARK)
  })

  return null
}

function DashboardOrgSwitcher({ organizationId }: { organizationId: string }) {
  useMountEffect(() => {
    if (activeOrganizationSwitches.has(organizationId)) return

    activeOrganizationSwitches.add(organizationId)
    mark(DASHBOARD_CONTEXT_START_MARK)
    void organization.setActive({ organizationId }).finally(() => {
      activeOrganizationSwitches.delete(organizationId)
      localStorage.setItem(DASHBOARD_ORG_KEY, organizationId)
      mark(DASHBOARD_CONTEXT_END_MARK)
      measure(
        'dashboard:context:init',
        DASHBOARD_CONTEXT_START_MARK,
        DASHBOARD_CONTEXT_END_MARK,
      )
    })
  })

  return null
}

function PersistDashboardOrgSelection({
  organizationId,
}: {
  organizationId: string
}) {
  useMountEffect(() => {
    localStorage.setItem(DASHBOARD_ORG_KEY, organizationId)
  })

  return null
}

function DashboardReadyMarker() {
  useMountEffect(() => {
    mark(DASHBOARD_LAYOUT_READY_MARK)
    measure(
      'dashboard:layout:ready',
      DASHBOARD_LAYOUT_MOUNT_MARK,
      DASHBOARD_LAYOUT_READY_MARK,
    )
  })

  return null
}
