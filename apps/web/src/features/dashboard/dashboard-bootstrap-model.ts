export type DashboardOrganizationLike = {
  id: string
  type?: string | null
}

export type DashboardBootstrapInput = {
  organizations: DashboardOrganizationLike[] | null | undefined
  activeOrganization: DashboardOrganizationLike | null | undefined
  storedOrganizationId: string | null
  organizationsLoading: boolean
  activeOrganizationLoading: boolean
  pathname: string
}

export type DashboardBootstrapState = {
  activeLabOrganization: DashboardOrganizationLike | null
  effectiveActiveOrganizationId: string | null
  hasAnyOrganizations: boolean
  hasLabAccess: boolean
  isBootstrappingContext: boolean
  isContextSwitching: boolean
  isDashboardHome: boolean
  needsDashboardOrgSwitch: boolean
  preferredDashboardOrganization: DashboardOrganizationLike | null
  shouldBlockChildRoutes: boolean
  shouldShowOnboarding: boolean
  shouldShowRestricted: boolean
  storedLabOrganization: DashboardOrganizationLike | null
}

export function getDashboardBootstrapState({
  activeOrganization,
  activeOrganizationLoading,
  organizations,
  organizationsLoading,
  pathname,
  storedOrganizationId,
}: DashboardBootstrapInput): DashboardBootstrapState {
  const labOrganizations =
    organizations?.filter((org) => org.type !== 'CLIENT') ?? []
  const storedLabOrganization = storedOrganizationId
    ? (labOrganizations.find((org) => org.id === storedOrganizationId) ?? null)
    : null
  const activeLabOrganization =
    activeOrganization?.type !== 'CLIENT'
      ? (labOrganizations.find((org) => org.id === activeOrganization?.id) ??
        null)
      : null

  const isDashboardHome =
    pathname === '/dashboard' || pathname === '/dashboard/'
  const hasLabAccess = labOrganizations.length > 0
  const hasAnyOrganizations = (organizations?.length ?? 0) > 0
  const hasLoadedOrganizations = !organizationsLoading
  const preferredDashboardOrganization =
    storedLabOrganization ??
    activeLabOrganization ??
    labOrganizations[0] ??
    null
  const needsDashboardOrgSwitch =
    hasLoadedOrganizations &&
    !activeOrganizationLoading &&
    hasLabAccess &&
    Boolean(preferredDashboardOrganization) &&
    activeOrganization?.id !== preferredDashboardOrganization?.id
  const isBootstrappingContext =
    !hasLoadedOrganizations ||
    activeOrganizationLoading ||
    needsDashboardOrgSwitch
  const isContextSwitching = isBootstrappingContext
  const shouldBlockChildRoutes = !isDashboardHome && isContextSwitching
  const effectiveActiveOrganizationId = activeLabOrganization?.id ?? null
  const shouldShowOnboarding =
    !isBootstrappingContext && !hasLabAccess && !hasAnyOrganizations
  const shouldShowRestricted =
    !isBootstrappingContext && !hasLabAccess && hasAnyOrganizations

  return {
    activeLabOrganization,
    effectiveActiveOrganizationId,
    hasAnyOrganizations,
    hasLabAccess,
    isBootstrappingContext,
    isContextSwitching,
    isDashboardHome,
    needsDashboardOrgSwitch,
    preferredDashboardOrganization,
    shouldBlockChildRoutes,
    shouldShowOnboarding,
    shouldShowRestricted,
    storedLabOrganization,
  }
}
