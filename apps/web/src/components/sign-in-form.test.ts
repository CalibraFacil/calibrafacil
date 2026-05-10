// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'

import { startDesktopInitialSync } from './sign-in-form'

describe('startDesktopInitialSync', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    delete (window as typeof window & { calibraBridge?: unknown }).calibraBridge
  })

  it('starts desktop sync through the bridge after lab sign-in', () => {
    const startSync = vi.fn(async () => undefined)
    installBridge({ startSync })

    startDesktopInitialSync()

    expect(startSync).toHaveBeenCalledTimes(1)
  })

  it('does nothing when the desktop bridge is unavailable', () => {
    expect(() => startDesktopInitialSync()).not.toThrow()
  })

  it('does not surface sync startup failures to the sign-in flow', async () => {
    const startSync = vi.fn(async () => {
      throw new Error('sync failed')
    })
    installBridge({ startSync })

    startDesktopInitialSync()
    await Promise.resolve()

    expect(startSync).toHaveBeenCalledTimes(1)
  })
})

function installBridge(bridge: { startSync: () => Promise<unknown> }) {
  Object.defineProperty(window, 'calibraBridge', {
    configurable: true,
    value: bridge,
  })
}
