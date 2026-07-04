// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mocks = vi.hoisted(() => ({
  usePlanAccess: vi.fn(),
  useBillingSubscriptionData: vi.fn(),
  useBillingPaymentsData: vi.fn(),
}))

vi.mock('@/hooks/use-plan-access', () => ({
  usePlanAccess: mocks.usePlanAccess,
}))

vi.mock('@/features/settings/queries', () => ({
  useBillingSubscriptionData: mocks.useBillingSubscriptionData,
  useBillingPaymentsData: mocks.useBillingPaymentsData,
}))

import { BillingSettingsPage } from './billing-page'

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('BillingSettingsPage storage meter', () => {
  // REQ-DOM-STG-002: storage usage is displayed like the jobs and users meters.
  it('REQ-DOM-STG-002: displays real storage usage alongside jobs and users', () => {
    mocks.usePlanAccess.mockReturnValue({
      isSuccess: true,
      data: {
        planId: 'STANDARD',
        planName: 'Standard',
        hasFinancialModule: true,
        canManageBilling: true,
        limits: {
          certificates: 100,
          users: 10,
          storage: 5 * 1024 * 1024 * 1024,
        },
      },
    })
    mocks.useBillingSubscriptionData.mockReturnValue({
      data: {
        subscription: { status: 'ACTIVE', billingCycle: 'MONTHLY' },
        plan: { id: 'STANDARD', name: 'Standard', description: '' },
        usage: { jobsCreated: 3, users: 2, storage: 50 * 1024 * 1024 },
        limits: {
          certificates: 100,
          users: 10,
          storage: 5 * 1024 * 1024 * 1024,
        },
      },
    })
    mocks.useBillingPaymentsData.mockReturnValue({
      data: { data: [] },
      isLoading: false,
    })

    renderWithClient(<BillingSettingsPage />)

    // Label present, exactly like the "Usuarios" meter.
    expect(screen.getByText('Armazenamento')).toBeTruthy()
    // Real usage + limit rendered (50 MB used of 5 GB) — NOT the old 0 placeholder.
    expect(
      screen.getByText(
        (text) => text.includes('50 MB') && text.includes('5 GB'),
      ),
    ).toBeTruthy()
  })

  it('REQ-DOM-STG-002: shows 0 B when the org has no size-tracked objects', () => {
    mocks.usePlanAccess.mockReturnValue({
      isSuccess: true,
      data: {
        planId: 'FREE',
        planName: 'Gratuito',
        hasFinancialModule: false,
        canManageBilling: true,
        limits: { certificates: 10, users: 1, storage: 100 * 1024 * 1024 },
      },
    })
    mocks.useBillingSubscriptionData.mockReturnValue({
      data: {
        subscription: null,
        plan: { id: 'FREE', name: 'Gratuito', description: '' },
        usage: { jobsCreated: 0, users: 1, storage: 0 },
        limits: { certificates: 10, users: 1, storage: 100 * 1024 * 1024 },
      },
    })
    mocks.useBillingPaymentsData.mockReturnValue({
      data: { data: [] },
      isLoading: false,
    })

    renderWithClient(<BillingSettingsPage />)

    expect(screen.getByText('Armazenamento')).toBeTruthy()
    expect(
      screen.getByText(
        (text) => text.includes('0 B') && text.includes('100 MB'),
      ),
    ).toBeTruthy()
  })
})
