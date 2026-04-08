import {
  Outlet,
  createFileRoute,
  redirect,
  useMatches,
  useNavigate,
} from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'

import {
  organization,
  useActiveOrganization,
  useListOrganizations,
} from '@calibra-facil/auth/client'
import { AppSidebar } from '@/components/app-sidebar'
import { CommandPalette } from '@/components/command-palette/command-palette'
import { CommandPaletteProvider } from '@/components/command-palette/command-context'
import { DashboardHeader } from '@/components/dashboard-header'
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
import { DashboardContextStateContext } from '@/contexts/dashboard-context'

const DASHBOARD_ORG_KEY = 'dashboard-active-org'
const DASHBOARD_LAYOUT_MOUNT_MARK = 'dashboard:layout:mount'
const DASHBOARD_LAYOUT_READY_MARK = 'dashboard:layout:ready'
const DASHBOARD_CONTEXT_START_MARK = 'dashboard:context:start'
const DASHBOARD_CONTEXT_END_MARK = 'dashboard:context:end'

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
  beforeLoad: async ({ location }) => {
    const { data: session } = await authClient.getSession()

    if (!session) {
      throw redirect({
        to: '/sign-in',
        search: { redirect: location.pathname },
      })
    }
  },
  component: DashboardLayout,
})

function DashboardLayout() {
  const navigate = useNavigate()
  const matches = useMatches()
  const { data: organizations, isPending: organizationsLoading } =
    useListOrganizations()
  const { data: activeOrg, isPending: activeOrgLoading } =
    useActiveOrganization()

  const hasMarkedReady = useRef(false)
  const [isSettingUp, setIsSettingUp] = useState(false)
  const [resolvedDashboardOrgId, setResolvedDashboardOrgId] = useState<
    string | null
  >(null)

  useEffect(() => {
    mark(DASHBOARD_LAYOUT_MOUNT_MARK)
  }, [])

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

  const pathname = matches[matches.length - 1]?.pathname ?? ''
  const isDashboardHome =
    pathname === '/dashboard' || pathname === '/dashboard/'
  const hasLabAccess = labOrganizations.length > 0
  const hasLoadedOrganizations = !organizationsLoading
  const preferredDashboardOrg =
    storedLabOrg ?? activeLabOrg ?? labOrganizations[0] ?? null
  const needsInitialDashboardOrg =
    hasLoadedOrganizations &&
    hasLabAccess &&
    !resolvedDashboardOrgId &&
    (activeOrgLoading || Boolean(preferredDashboardOrg))
  const isBootstrappingContext =
    !hasLoadedOrganizations || needsInitialDashboardOrg
  const isContextSwitching = isBootstrappingContext || isSettingUp
  const shouldBlockChildRoutes = !isDashboardHome && isContextSwitching
  const effectiveActiveOrganizationId = hasLabAccess
    ? resolvedDashboardOrgId
    : null

  useEffect(() => {
    async function setupDashboardContext() {
      if (!hasLoadedOrganizations || activeOrgLoading || isSettingUp) return

      if (!hasLabAccess) {
        setResolvedDashboardOrgId(null)
        setIsSettingUp(false)
        return
      }

      const targetOrg = preferredDashboardOrg

      if (!targetOrg) {
        setResolvedDashboardOrgId(null)
        return
      }

      if (activeOrg?.id !== targetOrg.id) {
        setIsSettingUp(true)
        mark(DASHBOARD_CONTEXT_START_MARK)
        try {
          await organization.setActive({ organizationId: targetOrg.id })
          localStorage.setItem(DASHBOARD_ORG_KEY, targetOrg.id)
          setResolvedDashboardOrgId(targetOrg.id)
        } finally {
          mark(DASHBOARD_CONTEXT_END_MARK)
          measure(
            'dashboard:context:init',
            DASHBOARD_CONTEXT_START_MARK,
            DASHBOARD_CONTEXT_END_MARK,
          )
          setIsSettingUp(false)
        }
      } else {
        // Store current selection
        localStorage.setItem(DASHBOARD_ORG_KEY, targetOrg.id)
        setResolvedDashboardOrgId(targetOrg.id)
      }
    }

    setupDashboardContext()
  }, [
    activeOrgLoading,
    hasLoadedOrganizations,
    hasLabAccess,
    isSettingUp,
    preferredDashboardOrg,
    activeOrg?.id,
  ])

  useEffect(() => {
    if (!hasLabAccess) {
      setResolvedDashboardOrgId(null)
      return
    }

    if (activeLabOrg?.id) {
      setResolvedDashboardOrgId(activeLabOrg.id)
    }
  }, [activeLabOrg?.id, hasLabAccess])

  useEffect(() => {
    if (!isContextSwitching && !hasMarkedReady.current) {
      hasMarkedReady.current = true
      mark(DASHBOARD_LAYOUT_READY_MARK)
      measure(
        'dashboard:layout:ready',
        DASHBOARD_LAYOUT_MOUNT_MARK,
        DASHBOARD_LAYOUT_READY_MARK,
      )
    }
  }, [isContextSwitching])

  // No LAB access - show error page
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
      <CommandPaletteProvider>
        <SidebarProvider>
          <AppSidebar />
          <SidebarInset>
            <DashboardHeader suspendEntityQueries={isContextSwitching} />
            <main className="flex-1 p-4">
              {shouldBlockChildRoutes ? (
                <div className="space-y-4">
                  <div className="h-10 w-56 rounded-md border bg-card/60 animate-pulse" />
                  <div className="h-64 rounded-lg border bg-card/60 animate-pulse" />
                </div>
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
