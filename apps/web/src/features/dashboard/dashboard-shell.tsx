import { useMemo } from 'react'
import { Outlet, useLocation } from '@tanstack/react-router'
import {
  useActiveOrganization,
  useListOrganizations,
} from '@calibra-facil/auth/client'

import { AppSidebar } from '@/components/app-sidebar'
import { CommandPalette } from '@/components/command-palette/command-palette'
import { CommandPaletteProvider } from '@/components/command-palette/command-context'
import { DashboardHeader } from '@/components/dashboard-header'
import { SidebarMobileAutoClose } from '@/components/sidebar-mobile-autoclose'
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
import { getDashboardBootstrapState } from './dashboard-bootstrap-model'

export function DashboardLayout() {
  const location = useLocation()
  const cloudOnlyUnavailable = useDesktopCloudOnlyUnavailable()
  const { data: organizations, isPending: organizationsLoading } =
    useListOrganizations()
  const { data: activeOrg, isPending: activeOrgLoading } =
    useActiveOrganization()

  const storedOrgId = getStoredDashboardOrganizationId()
  const pathname = location.pathname
  const bootstrapState = getDashboardBootstrapState({
    activeOrganization: activeOrg,
    activeOrganizationLoading: activeOrgLoading,
    organizations,
    organizationsLoading,
    pathname,
    storedOrganizationId: storedOrgId,
  })
  const {
    effectiveActiveOrganizationId,
    isContextSwitching,
    needsDashboardOrgSwitch,
    preferredDashboardOrganization,
    shouldBlockChildRoutes,
    shouldShowOnboarding,
    shouldShowRestricted,
  } = bootstrapState
  const shouldBlockCloudOnlyRoute =
    !shouldBlockChildRoutes &&
    cloudOnlyUnavailable &&
    isCloudOnlyDashboardPath(pathname)

  const dashboardContextValue = useMemo(
    () => ({
      isContextSwitching,
      activeOrganizationId: effectiveActiveOrganizationId,
    }),
    [isContextSwitching, effectiveActiveOrganizationId],
  )

  if (shouldShowOnboarding) {
    return <DashboardOnboardingState />
  }

  if (shouldShowRestricted) {
    return <DashboardRestrictedState />
  }

  return (
    <DashboardContextStateContext.Provider value={dashboardContextValue}>
      <DashboardLayoutMountMarker />
      {preferredDashboardOrganization ? (
        <PersistDashboardOrgSelection
          key={`persist-${preferredDashboardOrganization.id}`}
          organizationId={preferredDashboardOrganization.id}
        />
      ) : null}
      {needsDashboardOrgSwitch && preferredDashboardOrganization ? (
        <DashboardOrgSwitcher
          key={`switch-${preferredDashboardOrganization.id}`}
          organizationId={preferredDashboardOrganization.id}
        />
      ) : null}
      {!isContextSwitching ? <DashboardReadyMarker /> : null}
      <CommandPaletteProvider>
        <SidebarProvider>
          <AppSidebar />
          <SidebarMobileAutoClose />
          <SidebarInset>
            <DashboardHeader suspendEntityQueries={isContextSwitching} />
            <main className="flex-1 space-y-4 p-4">
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
