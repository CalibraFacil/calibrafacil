import {
  DASHBOARD_ORG_KEY,
  DASHBOARD_UNIT_KEY_PREFIX,
} from '@/app/config/runtime'

function getLocalStorage() {
  if (typeof window === 'undefined') return null

  return window.localStorage
}

export function getStoredDashboardOrganizationId() {
  return getLocalStorage()?.getItem(DASHBOARD_ORG_KEY) ?? null
}

export function setStoredDashboardOrganizationId(organizationId: string) {
  getLocalStorage()?.setItem(DASHBOARD_ORG_KEY, organizationId)
}

export function getStoredDashboardActiveUnitIdForOrganization(
  organizationId: string | null,
) {
  if (!organizationId) return null

  return (
    getLocalStorage()?.getItem(
      `${DASHBOARD_UNIT_KEY_PREFIX}${organizationId}`,
    ) ?? null
  )
}

export function getStoredDashboardActiveUnitId() {
  return getStoredDashboardActiveUnitIdForOrganization(
    getStoredDashboardOrganizationId(),
  )
}

export function setStoredDashboardActiveUnitIdForOrganization(
  organizationId: string,
  unitId: string,
) {
  getLocalStorage()?.setItem(
    `${DASHBOARD_UNIT_KEY_PREFIX}${organizationId}`,
    unitId,
  )
}
