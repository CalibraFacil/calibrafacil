import { Outlet, useLocation } from '@tanstack/react-router'
import {
  useActiveOrganization,
  useListOrganizations,
} from '@calibra-facil/auth/client'

import { AppSidebar } from '@/components/app-sidebar'
import { CommandPalette } from '@/components/command-palette/command-palette'
import { CommandPaletteProvider } from '@/components/command-palette/command-context'
import { DashboardHeader } from '@/components/dashboard-header'
import { UnitScopeBanner } from '@/components/unit-scope-banner'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { DashboardContextStateContext } from '@/contexts/dashboard-context'
import {
  CloudOnlyOfflineState,
  useDesktopCloudOnlyUnavailable,
} from '@/runtime/sync-status'
import { isCloudOnlyDashboardPath } from '@/runtime/cloud-only-routes'
import {
  DashboardLayoutMountMarker,
  DashboardOrgSwitcher,
  DashboardReadyMarker,
  PersistDashboardOrgSelection,
} from './dashboard-org-bootstrap'
import { getStoredDashboardOrganizationId } from './dashboard-scope-storage'
import {
  DashboardOnboardingState,
  DashboardRestrictedState,
} from './dashboard-access-states'

export function DashboardLayout() {
  const location = useLocation()
  const cloudOnlyUnavailable = useDesktopCloudOnlyUnavailable()
  const { data: organizations, isPending: organizationsLoading } =
    useListOrganizations()
  const { data: activeOrg, isPending: activeOrgLoading } =
    useActiveOrganization()

  const labOrganizations =
    organizations?.filter((org) => org.type !== 'CLIENT') ?? []
  const storedOrgId = getStoredDashboardOrganizationId()
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

  if (!isBootstrappingContext && !hasLabAccess && !hasAnyOrganizations) {
    return <DashboardOnboardingState />
  }

  if (!isBootstrappingContext && !hasLabAccess) {
    return <DashboardRestrictedState />
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
