import { Outlet, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'

import { AppSidebar } from '@/components/app-sidebar'
import { CommandPalette } from '@/components/command-palette/command-palette'
import { CommandPaletteProvider } from '@/components/command-palette/command-context'
import { DashboardHeader } from '@/components/dashboard-header'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { authMiddleware } from '@/middleware/auth'
import { useListOrganizations, useActiveOrganization } from '@calibra-facil/auth/client'
import { Spinner } from '@/components/ui/spinner'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export const Route = createFileRoute('/dashboard')({
  server: {
    middleware: [authMiddleware],
  },
  component: DashboardLayout,
})

function DashboardLayout() {
  const navigate = useNavigate()
  const { data: organizations, isPending: orgsLoading } = useListOrganizations()
  const { data: activeOrg, isPending: activeOrgLoading } = useActiveOrganization()

  // Check if user has any LAB organizations
  const labOrganizations = organizations?.filter(
    (org) => (org.metadata as { type?: string } | null)?.type !== 'CLIENT'
  ) ?? []

  const hasLabAccess = labOrganizations.length > 0

  // If user has lab orgs but no active org, or active org is CLIENT, auto-switch
  useEffect(() => {
    if (!orgsLoading && !activeOrgLoading && hasLabAccess) {
      const activeOrgType = (activeOrg?.metadata as { type?: string } | null)?.type
      if (!activeOrg || activeOrgType === 'CLIENT') {
        // Auto-switch to first LAB organization
        // The organization switcher component handles this
      }
    }
  }, [orgsLoading, activeOrgLoading, hasLabAccess, activeOrg])

  // Show loading state
  if (orgsLoading) {
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
              Esta área é exclusiva para usuários do laboratório.
              Se você é um cliente, acesse o Portal do Cliente.
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
