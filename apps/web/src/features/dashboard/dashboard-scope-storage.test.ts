import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  getStoredDashboardActiveUnitId,
  getStoredDashboardActiveUnitIdForOrganization,
  getStoredDashboardOrganizationId,
  setStoredDashboardActiveUnitIdForOrganization,
  setStoredDashboardOrganizationId,
} from './dashboard-scope-storage'

describe('dashboard scope storage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns null when window is unavailable', () => {
    vi.stubGlobal('window', undefined)

    expect(getStoredDashboardOrganizationId()).toBeNull()
    expect(getStoredDashboardActiveUnitId()).toBeNull()
  })

  it('reads and writes the stored organization id', () => {
    installLocalStorage()

    expect(getStoredDashboardOrganizationId()).toBeNull()

    setStoredDashboardOrganizationId('org-1')

    expect(getStoredDashboardOrganizationId()).toBe('org-1')
  })

  it('reads the active unit for the active organization using the stable key format', () => {
    const storage = installLocalStorage()

    setStoredDashboardOrganizationId('org-1')
    setStoredDashboardActiveUnitIdForOrganization('org-1', 'all')

    expect(getStoredDashboardActiveUnitId()).toBe('all')
    expect(getStoredDashboardActiveUnitIdForOrganization('org-1')).toBe('all')
    expect(storage.getItem('dashboard-active-unit:org-1')).toBe('all')
  })
})

function installLocalStorage() {
  const storage = createMemoryStorage()
  vi.stubGlobal('window', { localStorage: storage })

  return storage
}

function createMemoryStorage() {
  const values = new Map<string, string>()

  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value)
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key)
    }),
  }
}
