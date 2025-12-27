import { Outlet, createFileRoute, useNavigate } from '@tanstack/react-router'
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
import { authMiddleware } from '@/middleware/auth'
import { Spinner } from '@/components/ui/spinner'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'

const DASHBOARD_ORG_KEY = 'dashboard-active-org'

export const Route = createFileRoute('/dashboard')({
  server: {
    middleware: [authMiddleware],
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
  const [isSettingUp, setIsSettingUp] = useState(true)

  // Check if user has any LAB organizations
  // The 'type' field is a direct column on organization table (not in metadata)
  const labOrganizations =
    organizations?.filter((org) => org.type !== 'CLIENT') ?? []

  const hasLabAccess = labOrganizations.length > 0

  // Context Setup: Only runs once on initial load
  // Uses localStorage to remember preferred org, avoiding conflicts with portal
  useEffect(() => {
    async function setupDashboardContext() {
      if (orgsLoading || activeOrgLoading || hasSetupContext.current) return
      if (!hasLabAccess) {
        setIsSettingUp(false)
        return
      }

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
        await organization.setActive({ organizationId: targetOrg.id })
        localStorage.setItem(DASHBOARD_ORG_KEY, targetOrg.id)
      } else if (targetOrg) {
        // Store current selection
        localStorage.setItem(DASHBOARD_ORG_KEY, targetOrg.id)
      }

      setIsSettingUp(false)
    }

    setupDashboardContext()
  }, [orgsLoading, activeOrgLoading, hasLabAccess, activeOrg, labOrganizations])

  // Show loading state while loading orgs or setting up context
  if (orgsLoading || activeOrgLoading || isSettingUp) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Spinner className="size-8" />
      </div>
    )
  }

  // No LAB access - show error page
  if (!hasLabAccess) {
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
          <DashboardHeader />
          <main className="flex-1 p-4">
            <Outlet />
          </main>
        </SidebarInset>
      </SidebarProvider>
      <CommandPalette />
    </CommandPaletteProvider>
  )
}
