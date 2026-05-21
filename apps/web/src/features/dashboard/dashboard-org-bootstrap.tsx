import { organization } from '@calibra-facil/auth/client'

import { useMountEffect } from '@/hooks/use-mount-effect'
import { setStoredDashboardOrganizationId } from './dashboard-scope-storage'
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
  useMountEffect(() => {
    if (activeOrganizationSwitches.has(organizationId)) return

    activeOrganizationSwitches.add(organizationId)
    mark(DASHBOARD_CONTEXT_START_MARK)
    void organization.setActive({ organizationId }).finally(() => {
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
