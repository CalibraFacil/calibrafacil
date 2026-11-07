import { useQueryClient } from '@tanstack/react-query'

import { useMountEffect } from '@calibra-facil/ui/use-mount-effect'
import { setStoredDashboardOrganizationId } from '@/lib/dashboard-scope-storage'
import {
  switchActiveOrganization,
  watchOtherTabScope,
} from '@/lib/switch-scope'
import {
  DASHBOARD_CONTEXT_END_MARK,
  DASHBOARD_CONTEXT_START_MARK,
  DASHBOARD_LAYOUT_MOUNT_MARK,
  DASHBOARD_LAYOUT_READY_MARK,
  mark,
  measure,
} from './dashboard-performance'

const activeOrganizationSwitches = new Set<string>()

export function DashboardLayoutMountMarker() {
  useMountEffect(() => {
    mark(DASHBOARD_LAYOUT_MOUNT_MARK)
  })

  return null
}

export function DashboardOrgSwitcher({
  organizationId,
}: {
  organizationId: string
}) {
  const queryClient = useQueryClient()

  useMountEffect(() => {
    if (activeOrganizationSwitches.has(organizationId)) return

    activeOrganizationSwitches.add(organizationId)
    mark(DASHBOARD_CONTEXT_START_MARK)
    // The session may still name another laboratory than the one this page
    // chose, and anything fetched meanwhile came from it: reset with the switch.
    void switchActiveOrganization(queryClient, organizationId).finally(() => {
      activeOrganizationSwitches.delete(organizationId)
      setStoredDashboardOrganizationId(organizationId)
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

export function PersistDashboardOrgSelection({
  organizationId,
}: {
  organizationId: string
}) {
  useMountEffect(() => {
    setStoredDashboardOrganizationId(organizationId)
  })

  return null
}

/** Resets this tab's cache when another tab switches organization or unit. */
export function CrossTabScopeSync() {
  const queryClient = useQueryClient()

  useMountEffect(() => watchOtherTabScope(queryClient))

  return null
}

export function DashboardReadyMarker() {
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
