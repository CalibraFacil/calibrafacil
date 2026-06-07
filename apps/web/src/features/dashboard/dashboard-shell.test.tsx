// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const routerMocks = vi.hoisted(() => ({
  pathname: '/dashboard',
}))

const authMocks = vi.hoisted(() => ({
  setActive: vi.fn(),
  useActiveOrganization: vi.fn(),
  useListOrganizations: vi.fn(),
}))

const syncMocks = vi.hoisted(() => ({
  cloudOnlyUnavailable: false,
}))

vi.mock('@tanstack/react-router', () => ({
  Outlet: () => <div>dashboard outlet</div>,
  useLocation: () => ({ pathname: routerMocks.pathname }),
}))

vi.mock('@calibra-facil/auth/client', () => ({
  organization: {
    setActive: authMocks.setActive,
  },
  useActiveOrganization: authMocks.useActiveOrganization,
  useListOrganizations: authMocks.useListOrganizations,
}))

vi.mock('@/components/app-sidebar', () => ({
  AppSidebar: () => <aside>sidebar</aside>,
}))

vi.mock('@/components/sidebar-mobile-autoclose', () => ({
  SidebarMobileAutoClose: () => null,
}))

vi.mock('@/components/command-palette/command-context', () => ({
  CommandPaletteProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}))

vi.mock('@/components/command-palette/command-palette', () => ({
  CommandPalette: () => <div>command palette</div>,
}))

vi.mock('@/components/dashboard-header', () => ({
  DashboardHeader: ({
    suspendEntityQueries,
  }: {
    suspendEntityQueries?: boolean
  }) => <header>{suspendEntityQueries ? 'header suspended' : 'header'}</header>,
}))

vi.mock('@/components/ui/sidebar', () => ({
  SidebarInset: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarProvider: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

vi.mock('@/runtime/sync-status', () => ({
  CloudOnlyOfflineState: ({ title }: { title: string }) => <div>{title}</div>,
  useDesktopCloudOnlyUnavailable: () => syncMocks.cloudOnlyUnavailable,
}))

vi.mock('./dashboard-performance', () => ({
  DASHBOARD_CONTEXT_END_MARK: 'dashboard:context:end',
  DASHBOARD_CONTEXT_START_MARK: 'dashboard:context:start',
  DASHBOARD_LAYOUT_MOUNT_MARK: 'dashboard:layout:mount',
  DASHBOARD_LAYOUT_READY_MARK: 'dashboard:layout:ready',
  mark: vi.fn(),
  measure: vi.fn(),
}))

import { DASHBOARD_ORG_KEY } from '@/app/config/runtime'
import { DashboardLayout } from './dashboard-shell'

describe('DashboardLayout bootstrap workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    routerMocks.pathname = '/dashboard'
    syncMocks.cloudOnlyUnavailable = false
    authMocks.setActive.mockResolvedValue(undefined)
    authMocks.useListOrganizations.mockReturnValue({
      data: [{ id: 'lab-1', type: 'LAB' }],
      isPending: false,
    })
    authMocks.useActiveOrganization.mockReturnValue({
      data: { id: 'lab-1', type: 'LAB' },
      isPending: false,
    })
  })

  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('switches to the stored lab organization and blocks child routes while context is changing', async () => {
    routerMocks.pathname = '/dashboard/jobs'
    localStorage.setItem(DASHBOARD_ORG_KEY, 'lab-2')
    authMocks.useListOrganizations.mockReturnValue({
      data: [
        { id: 'lab-1', type: 'LAB' },
        { id: 'lab-2', type: 'LAB' },
      ],
      isPending: false,
    })

    render(<DashboardLayout />)

    expect(screen.getByText('header suspended')).toBeTruthy()
    expect(screen.queryByText('dashboard outlet')).toBeNull()
    expect(authMocks.setActive).toHaveBeenCalledWith({
      organizationId: 'lab-2',
    })
    await waitFor(() => {
      expect(localStorage.getItem(DASHBOARD_ORG_KEY)).toBe('lab-2')
    })
  })

  it('renders the cloud-only offline state instead of child routes for cloud-only dashboard paths', () => {
    routerMocks.pathname = '/dashboard/finance'
    syncMocks.cloudOnlyUnavailable = true

    render(<DashboardLayout />)

    expect(screen.getByText('Tela indisponível offline')).toBeTruthy()
    expect(screen.queryByText('dashboard outlet')).toBeNull()
    expect(authMocks.setActive).not.toHaveBeenCalled()
  })
})
