import { describe, expect, it } from 'vitest'

import { getDashboardBootstrapState } from './dashboard-bootstrap-model'

describe('getDashboardBootstrapState', () => {
  it('prefers a stored lab organization and blocks child routes while switching context', () => {
    const state = getDashboardBootstrapState({
      organizations: [
        { id: 'client-1', type: 'CLIENT' },
        { id: 'lab-1', type: 'LAB' },
        { id: 'lab-2', type: 'LAB' },
      ],
      activeOrganization: { id: 'lab-1', type: 'LAB' },
      storedOrganizationId: 'lab-2',
      organizationsLoading: false,
      activeOrganizationLoading: false,
      pathname: '/dashboard/jobs',
    })

    expect(state.preferredDashboardOrganization?.id).toBe('lab-2')
    expect(state.needsDashboardOrgSwitch).toBe(true)
    expect(state.isContextSwitching).toBe(true)
    expect(state.shouldBlockChildRoutes).toBe(true)
  })

  it('uses the active lab organization when the stored organization is not a lab organization', () => {
    const state = getDashboardBootstrapState({
      organizations: [
        { id: 'client-1', type: 'CLIENT' },
        { id: 'lab-1', type: 'LAB' },
      ],
      activeOrganization: { id: 'lab-1', type: 'LAB' },
      storedOrganizationId: 'client-1',
      organizationsLoading: false,
      activeOrganizationLoading: false,
      pathname: '/dashboard',
    })

    expect(state.storedLabOrganization).toBeNull()
    expect(state.preferredDashboardOrganization?.id).toBe('lab-1')
    expect(state.needsDashboardOrgSwitch).toBe(false)
    expect(state.shouldBlockChildRoutes).toBe(false)
  })

  it('shows onboarding only after loading an account with no organizations', () => {
    const state = getDashboardBootstrapState({
      organizations: [],
      activeOrganization: null,
      storedOrganizationId: null,
      organizationsLoading: false,
      activeOrganizationLoading: false,
      pathname: '/dashboard',
    })

    expect(state.shouldShowOnboarding).toBe(true)
    expect(state.shouldShowRestricted).toBe(false)
  })

  it('shows restricted state for users with only client organizations', () => {
    const state = getDashboardBootstrapState({
      organizations: [{ id: 'client-1', type: 'CLIENT' }],
      activeOrganization: { id: 'client-1', type: 'CLIENT' },
      storedOrganizationId: null,
      organizationsLoading: false,
      activeOrganizationLoading: false,
      pathname: '/dashboard',
    })

    expect(state.hasAnyOrganizations).toBe(true)
    expect(state.hasLabAccess).toBe(false)
    expect(state.shouldShowRestricted).toBe(true)
  })

  it('does not show terminal access states while organization data is loading', () => {
    const state = getDashboardBootstrapState({
      organizations: undefined,
      activeOrganization: undefined,
      storedOrganizationId: null,
      organizationsLoading: true,
      activeOrganizationLoading: true,
      pathname: '/dashboard/jobs',
    })

    expect(state.isBootstrappingContext).toBe(true)
    expect(state.shouldBlockChildRoutes).toBe(true)
    expect(state.shouldShowOnboarding).toBe(false)
    expect(state.shouldShowRestricted).toBe(false)
  })
})
