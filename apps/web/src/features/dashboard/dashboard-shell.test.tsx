// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const routerMocks = vi.hoisted(() => ({
  pathname: '/dashboard',
  routeId: '/dashboard/',
}))

const authMocks = vi.hoisted(() => ({
  setActive: vi.fn(),
  useActiveOrganization: vi.fn(),
  useListOrganizations: vi.fn(),
  useSession: vi.fn(() => ({ data: { user: { id: 'user-1' } } })),
}))

const syncMocks = vi.hoisted(() => ({
  cloudOnlyUnavailable: false,
}))

vi.mock('@tanstack/react-router', () => ({
  Outlet: () => <div>dashboard outlet</div>,
  useLocation: () => ({ pathname: routerMocks.pathname }),
  useMatches: ({
    select,
  }: {
    select: (matches: Array<{ routeId: string }>) => string
  }) =>
    select([
      { routeId: '__root__' },
      { routeId: '/dashboard' },
      { routeId: routerMocks.routeId },
    ]),
}))

vi.mock('@calibra-facil/auth/client', () => ({
  organization: {
    setActive: authMocks.setActive,
  },
  useActiveOrganization: authMocks.useActiveOrganization,
  useListOrganizations: authMocks.useListOrganizations,
  useSession: authMocks.useSession,
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

function renderDashboard() {
  // The shell resolves the desktop local-database partition through React
  // Query. In the browser that query is disabled, so this only supplies the
  // client the hook requires.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <DashboardLayout />
    </QueryClientProvider>,
  )
}

describe('DashboardLayout bootstrap workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    routerMocks.pathname = '/dashboard'
    routerMocks.routeId = '/dashboard/'
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
    routerMocks.routeId = '/dashboard/jobs/'
    localStorage.setItem(DASHBOARD_ORG_KEY, 'lab-2')
    authMocks.useListOrganizations.mockReturnValue({
      data: [
        { id: 'lab-1', type: 'LAB' },
        { id: 'lab-2', type: 'LAB' },
      ],
      isPending: false,
    })

    renderDashboard()

    expect(screen.getByText('header suspended')).toBeTruthy()
    expect(screen.queryByText('dashboard outlet')).toBeNull()
    expect(authMocks.setActive).toHaveBeenCalledWith({
      organizationId: 'lab-2',
    })
    await waitFor(() => {
      expect(localStorage.getItem(DASHBOARD_ORG_KEY)).toBe('lab-2')
    })
  })

  it('REQ-OFF-4: renders the online-only state instead of child routes for areas outside the offline scope', () => {
    routerMocks.pathname = '/dashboard/finance'
    routerMocks.routeId = '/dashboard/finance/'
    syncMocks.cloudOnlyUnavailable = true

    renderDashboard()

    expect(screen.getByText('Disponível apenas online')).toBeTruthy()
    expect(screen.queryByText('dashboard outlet')).toBeNull()
    expect(authMocks.setActive).not.toHaveBeenCalled()
  })

  it('REQ-OFF-4: a route nobody classified is online-only on a disconnected desktop', () => {
    routerMocks.pathname = '/dashboard/brand-new-page'
    routerMocks.routeId = '/dashboard/brand-new-page'
    syncMocks.cloudOnlyUnavailable = true

    renderDashboard()

    expect(screen.getByText('Disponível apenas online')).toBeTruthy()
    expect(screen.queryByText('dashboard outlet')).toBeNull()
  })

  it('keeps field capture on screen while disconnected', () => {
    routerMocks.pathname = '/dashboard/jobs/42/execute'
    routerMocks.routeId = '/dashboard/jobs/$id/execute'
    syncMocks.cloudOnlyUnavailable = true

    renderDashboard()

    expect(screen.getByText('dashboard outlet')).toBeTruthy()
    expect(screen.queryByText('Disponível apenas online')).toBeNull()
  })

  it('shows online-only areas normally while connected', () => {
    routerMocks.pathname = '/dashboard/finance'
    routerMocks.routeId = '/dashboard/finance/'
    syncMocks.cloudOnlyUnavailable = false

    renderDashboard()

    expect(screen.getByText('dashboard outlet')).toBeTruthy()
  })
})
