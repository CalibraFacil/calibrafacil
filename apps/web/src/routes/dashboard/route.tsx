import {
  Outlet,
  createFileRoute,
  redirect,
  useMatches,
  useNavigate,
} from '@tanstack/react-router'
import { createContext, useContext, useEffect, useRef, useState } from 'react'

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

const DASHBOARD_ORG_KEY = 'dashboard-active-org'
const DASHBOARD_LAYOUT_MOUNT_MARK = 'dashboard:layout:mount'
const DASHBOARD_LAYOUT_READY_MARK = 'dashboard:layout:ready'
const DASHBOARD_CONTEXT_START_MARK = 'dashboard:context:start'
const DASHBOARD_CONTEXT_END_MARK = 'dashboard:context:end'

type DashboardContextState = {
  isContextSwitching: boolean
  activeOrganizationId: string | null
}

const DashboardContextStateContext = createContext<DashboardContextState>({
  isContextSwitching: false,
  activeOrganizationId: null,
})

export function useDashboardContextState() {
  return useContext(DashboardContextStateContext)
}

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
  beforeLoad: async () => {
    const { data: session } = await authClient.getSession()

    if (!session) {
      throw redirect({ to: '/sign-in' })
    }
  },
  component: DashboardLayout,
})

function DashboardLayout() {
  const navigate = useNavigate()
  const matches = useMatches()
  const { data: organizations, isPending: orgsLoading } = useListOrganizations()
  const { data: activeOrg, isPending: activeOrgLoading } =
    useActiveOrganization()

  // Track if we've already done initial context setup
  const hasSetupContext = useRef(false)
  const hasMarkedReady = useRef(false)
  const [isSettingUp, setIsSettingUp] = useState(false)

  useEffect(() => {
    mark(DASHBOARD_LAYOUT_MOUNT_MARK)
  }, [])

  // Check if user has any LAB organizations
  // The 'type' field is a direct column on organization table (not in metadata)
  const labOrganizations =
    organizations?.filter((org) => org.type !== 'CLIENT') ?? []

  const pathname = matches[matches.length - 1]?.pathname ?? ''
  const isDashboardHome =
    pathname === '/dashboard' || pathname === '/dashboard/'
  const hasLabAccess = labOrganizations.length > 0
  const isBootstrappingContext = orgsLoading || activeOrgLoading
  const shouldBlockChildRoutes =
    !isDashboardHome && (isBootstrappingContext || isSettingUp)

  // Context Setup: Only runs once on initial load
  // Uses localStorage to remember preferred org, avoiding conflicts with portal
  useEffect(() => {
    async function setupDashboardContext() {
      if (orgsLoading || activeOrgLoading) return

      if (!hasLabAccess) {
        setIsSettingUp(false)
        return
      }

      if (hasSetupContext.current) return

      hasSetupContext.current = true

      // Get stored preference for dashboard
      const storedOrgId = localStorage.getItem(DASHBOARD_ORG_KEY)

      // Check if stored org is a valid LAB org
      const storedOrg = storedOrgId
        ? labOrganizations.find((org) => org.id === storedOrgId)
        : null

      // Determine target org: stored preference > current if LAB > first LAB
      let targetOrg = storedOrg
      if (!targetOrg && activeOrg?.type !== 'CLIENT') {
        targetOrg = labOrganizations.find((org) => org.id === activeOrg?.id)
      }
      if (!targetOrg) {
        targetOrg = labOrganizations[0]
      }

      // Only switch if needed
      if (targetOrg && activeOrg?.id !== targetOrg.id) {
        setIsSettingUp(true)
        mark(DASHBOARD_CONTEXT_START_MARK)
        try {
          await organization.setActive({ organizationId: targetOrg.id })
          localStorage.setItem(DASHBOARD_ORG_KEY, targetOrg.id)
        } finally {
          mark(DASHBOARD_CONTEXT_END_MARK)
          measure(
            'dashboard:context:init',
            DASHBOARD_CONTEXT_START_MARK,
            DASHBOARD_CONTEXT_END_MARK,
          )
          setIsSettingUp(false)
        }
      } else if (targetOrg) {
        // Store current selection
        localStorage.setItem(DASHBOARD_ORG_KEY, targetOrg.id)
      }
    }

    setupDashboardContext()
  }, [orgsLoading, activeOrgLoading, hasLabAccess, activeOrg, labOrganizations])

  useEffect(() => {
    if (
      !orgsLoading &&
      !activeOrgLoading &&
      !isSettingUp &&
      !hasMarkedReady.current
    ) {
      hasMarkedReady.current = true
      mark(DASHBOARD_LAYOUT_READY_MARK)
      measure(
        'dashboard:layout:ready',
        DASHBOARD_LAYOUT_MOUNT_MARK,
        DASHBOARD_LAYOUT_READY_MARK,
      )
    }
  }, [orgsLoading, activeOrgLoading, isSettingUp])

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
                window.location.href = `https://${host}:5174`
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
    <CommandPaletteProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <DashboardHeader
            suspendEntityQueries={isBootstrappingContext || isSettingUp}
          />
          <main className="flex-1 p-4">
            <DashboardContextStateContext.Provider
              value={{
                isContextSwitching: isBootstrappingContext || isSettingUp,
                activeOrganizationId: activeOrg?.id ?? null,
              }}
            >
              {shouldBlockChildRoutes ? (
                <div className="space-y-4">
                  <div className="h-10 w-56 rounded-md border bg-card/60 animate-pulse" />
                  <div className="h-64 rounded-lg border bg-card/60 animate-pulse" />
                </div>
              ) : (
                <Outlet />
              )}
            </DashboardContextStateContext.Provider>
          </main>
        </SidebarInset>
      </SidebarProvider>
      <CommandPalette />
    </CommandPaletteProvider>
  )
}
