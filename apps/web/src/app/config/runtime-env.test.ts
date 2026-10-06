import { afterEach, describe, expect, it, vi } from 'vitest'

import { runtimeEnv } from './runtime-env'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('runtimeEnv', () => {
  it('prefers the value the container served in /runtime-env.js', () => {
    vi.stubGlobal('window', {
      calibraRuntimeEnv: { VITE_PORTAL_APP_URL: 'https://portal.lab.example' },
    })

    expect(runtimeEnv('VITE_PORTAL_APP_URL', 'https://built.example')).toBe(
      'https://portal.lab.example',
    )
  })

  it('falls back to the build-time value when unset, blank or not a string', () => {
    vi.stubGlobal('window', {
      calibraRuntimeEnv: { VITE_A: '  ', VITE_B: 42 },
    })

    expect(runtimeEnv('VITE_A', 'built-a')).toBe('built-a')
    expect(runtimeEnv('VITE_B', 'built-b')).toBe('built-b')
    expect(runtimeEnv('VITE_C', undefined)).toBeUndefined()
  })

  it('uses the build-time value outside the browser', () => {
    expect(runtimeEnv('VITE_PORTAL_APP_URL', 'https://built.example')).toBe(
      'https://built.example',
    )
  })
})
