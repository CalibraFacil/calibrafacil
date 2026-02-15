import {
  Outlet,
  createFileRoute,
  redirect,
  useNavigate,
} from '@tanstack/react-router'
import { useEffect, useState, useRef } from 'react'

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
import { Spinner } from '@/components/ui/spinner'
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
  const { data: organizations, isPending: orgsLoading } = useListOrganizations()
  const { data: activeOrg, isPending: activeOrgLoading } =
    useActiveOrganization()

  // Track if we've already done initial context setup
  const hasSetupContext = useRef(false)
  const hasMarkedReady = useRef(false)
  const [isSettingUp, setIsSettingUp] = useState(true)

  useEffect(() => {
    mark(DASHBOARD_LAYOUT_MOUNT_MARK)
  }, [])

  // Check if user has any LAB organizations
  // The 'type' field is a direct column on organization table (not in metadata)
  const labOrganizations =
    organizations?.filter((org) => org.type !== 'CLIENT') ?? []

  const hasLabAccess = labOrganizations.length > 0
  const isInitializing = orgsLoading || activeOrgLoading || isSettingUp

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
      setIsSettingUp(true)
      mark(DASHBOARD_CONTEXT_START_MARK)

      try {
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
          await organization.setActive({ organizationId: targetOrg.id })
          localStorage.setItem(DASHBOARD_ORG_KEY, targetOrg.id)
        } else if (targetOrg) {
          // Store current selection
          localStorage.setItem(DASHBOARD_ORG_KEY, targetOrg.id)
        }
      } finally {
        mark(DASHBOARD_CONTEXT_END_MARK)
        measure(
          'dashboard:context:init',
          DASHBOARD_CONTEXT_START_MARK,
          DASHBOARD_CONTEXT_END_MARK,
        )
        setIsSettingUp(false)
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
  if (!isInitializing && !hasLabAccess) {
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
          <DashboardHeader suspendEntityQueries={isInitializing} />
          <main className="flex-1 p-4">
            {isInitializing ? (
              <div className="space-y-6">
                <div className="flex items-center gap-3 text-muted-foreground">
                  <Spinner className="size-5" />
                  <span>Configurando contexto do laboratório...</span>
                </div>

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <div
                      key={index}
                      className="h-28 rounded-lg border bg-card/50 animate-pulse"
                    />
                  ))}
                </div>

                <div className="grid gap-6 lg:grid-cols-2">
                  <div className="h-80 rounded-lg border bg-card/50 animate-pulse" />
                  <div className="h-80 rounded-lg border bg-card/50 animate-pulse" />
                </div>
              </div>
            ) : (
              <Outlet />
            )}
          </main>
        </SidebarInset>
      </SidebarProvider>
      <CommandPalette />
    </CommandPaletteProvider>
  )
}
