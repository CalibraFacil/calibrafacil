// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CONSENT_STORAGE_KEY } from '@/app/config/runtime'

import { applyStoredConsent, denyConsent, grantConsent } from './consent'
import { getStoredConsent, hasStoredConsent } from './consent-storage'
import { track } from './track'

const makeGtagMock = () => vi.fn<(...args: unknown[]) => void>()
let gtagMock = makeGtagMock()

function lastConsentUpdate() {
  return gtagMock.mock.calls.filter(
    (call) => call[0] === 'consent' && call[1] === 'update',
  )
}

// jsdom's built-in localStorage is a non-functional stub in this vitest setup,
// so install a minimal in-memory Storage the consent module can read/write.
function installMemoryStorage() {
  const map = new Map<string, string>()
  const storage: Storage = {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => Array.from(map.keys())[index] ?? null,
    removeItem: (key) => {
      map.delete(key)
    },
    setItem: (key, value) => {
      map.set(key, String(value))
    },
  }
  Object.defineProperty(window, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  })
}

beforeEach(() => {
  installMemoryStorage()
  window.dataLayer = []
  gtagMock = makeGtagMock()
  window.gtag = gtagMock
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('consent', () => {
  it('starts with no stored choice', () => {
    expect(hasStoredConsent()).toBe(false)
    expect(getStoredConsent()).toBeNull()
  })

  it('grantConsent persists and grants every Consent Mode signal', () => {
    grantConsent()

    const stored = getStoredConsent()
    expect(stored?.analytics).toBe(true)
    expect(stored?.ads).toBe(true)
    expect(typeof stored?.at).toBe('string')

    const [, , signals] = lastConsentUpdate().at(-1) ?? []
    expect(signals).toEqual({
      analytics_storage: 'granted',
      ad_storage: 'granted',
      ad_user_data: 'granted',
      ad_personalization: 'granted',
    })
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({ event: 'consent_update', consent_ads: true }),
    )
  })

  it('denyConsent persists a choice but denies every signal', () => {
    denyConsent()

    expect(getStoredConsent()?.ads).toBe(false)
    const [, , signals] = lastConsentUpdate().at(-1) ?? []
    expect(signals).toEqual({
      analytics_storage: 'denied',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
    })
  })

  it('applyStoredConsent re-applies a prior grant and no-ops when unset', () => {
    applyStoredConsent()
    expect(lastConsentUpdate()).toHaveLength(0)

    grantConsent()
    gtagMock.mockClear()

    applyStoredConsent()
    expect(lastConsentUpdate()).toHaveLength(1)
  })

  it('ignores malformed stored consent', () => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, '{"analytics":"yes"}')
    expect(getStoredConsent()).toBeNull()
    expect(hasStoredConsent()).toBe(false)
  })

  it('track pushes a named event onto the data layer', () => {
    track('demo_click', { location: 'hero' })
    expect(window.dataLayer).toContainEqual({
      event: 'demo_click',
      location: 'hero',
    })
  })
})
