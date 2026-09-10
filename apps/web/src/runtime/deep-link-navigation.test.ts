import { describe, expect, it, vi } from 'vitest'

import {
  subscribeToDeepLinks,
  type DeepLinkBridge,
} from './deep-link-navigation'

function createBridge() {
  const listeners: Array<(path: string) => void> = []
  const unsubscribe = vi.fn()
  const readyCalls: number[] = []

  const bridge: DeepLinkBridge = {
    onDeepLink(listener) {
      listeners.push(listener)
      return unsubscribe
    },
    async notifyDeepLinkReady() {
      readyCalls.push(listeners.length)
      return true
    },
  }

  return {
    bridge,
    unsubscribe,
    /** How many listeners existed at each `notifyDeepLinkReady` call. */
    readyCalls,
    emit(path: string) {
      for (const listener of listeners) listener(path)
    },
  }
}

describe('subscribeToDeepLinks', () => {
  it('navigates to the linked route', () => {
    const router = { navigate: vi.fn() }
    const bridge = createBridge()

    subscribeToDeepLinks(router, bridge.bridge)
    bridge.emit('/dashboard/jobs/12')

    expect(router.navigate).toHaveBeenCalledWith({ href: '/dashboard/jobs/12' })
  })

  it('passes search and hash through untouched', () => {
    const router = { navigate: vi.fn() }
    const bridge = createBridge()

    subscribeToDeepLinks(router, bridge.bridge)
    bridge.emit('/dashboard/jobs?status=REVIEW#evidence')

    expect(router.navigate).toHaveBeenCalledWith({
      href: '/dashboard/jobs?status=REVIEW#evidence',
    })
  })

  it('announces readiness only after the listener is attached', () => {
    // If this order flips, a link buffered during a cold launch is flushed
    // into a renderer that is not subscribed yet and is silently lost.
    const bridge = createBridge()

    subscribeToDeepLinks({ navigate: vi.fn() }, bridge.bridge)

    expect(bridge.readyCalls).toEqual([1])
  })

  it('returns the bridge unsubscribe so the listener does not leak', () => {
    const bridge = createBridge()

    subscribeToDeepLinks({ navigate: vi.fn() }, bridge.bridge)()

    expect(bridge.unsubscribe).toHaveBeenCalledOnce()
  })

  it('subscribes even when announcing readiness fails', async () => {
    const router = { navigate: vi.fn() }
    const bridge = createBridge()
    const failing: DeepLinkBridge = {
      onDeepLink: bridge.bridge.onDeepLink,
      notifyDeepLinkReady: () => Promise.reject(new Error('ipc down')),
    }

    subscribeToDeepLinks(router, failing)
    await Promise.resolve()
    bridge.emit('/dashboard/jobs/12')

    // A failed announcement must not cost us warm links.
    expect(router.navigate).toHaveBeenCalledOnce()
  })
})
