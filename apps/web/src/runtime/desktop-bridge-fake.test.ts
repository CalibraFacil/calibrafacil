import { afterEach, describe, expect, it, vi } from 'vitest'
import { LOCAL_SERVER_DEFAULT_URL } from '@calibra-facil/config/local-server-defaults'
import {
  desktopBridge,
  desktopBridgeEventMethods,
  desktopBridgeInvokeMethods,
  desktopBridgeMethods,
  type DesktopBridgeInvokeMethod,
} from '@calibra-facil/contracts/desktop-bridge'
import {
  installDesktopBridgeFake,
  type OrganizationFixture,
} from '../../e2e/desktop-bridge-fake'

/**
 * The browser e2e suite fakes `window.calibraBridge`. The bridge table in
 * `@calibra-facil/contracts` is the surface; this holds the fake to it, so a
 * method added to the table, or a response whose shape changed, fails here
 * instead of surfacing as a confusing browser-test failure.
 */

const organization: OrganizationFixture = {
  id: 'lab-1',
  name: 'Laboratório Central',
  slug: 'lab-1',
  type: 'LAB',
  members: [{ role: 'admin' }],
}

/** Arguments for the methods that take some; the rest are called bare. */
const sampleArguments: Partial<
  Record<DesktopBridgeInvokeMethod, readonly unknown[]>
> = {
  setSettings: [{}],
  deleteSecret: ['cloudAuthToken'],
  wakeSync: ['manual'],
  activateLocalPartition: [{ partition: null, identityVerified: false }],
  publishNotifications: [
    {
      organizationKey: 'lab-1',
      unreadCount: 0,
      highWaterMarkId: null,
      entries: [],
    },
  ],
  openExternal: ['https://calibrafacil.com'],
  authFetch: [
    {
      url: 'http://localhost:3000/api/units',
      method: 'GET',
      headers: [],
      body: null,
    },
  ],
}

function installFake() {
  const fakeWindow: { calibraBridge?: unknown } = {}
  vi.stubGlobal('window', fakeWindow)
  installDesktopBridgeFake({
    activeOrganization: organization,
    organizations: [organization],
    localServerUrl: LOCAL_SERVER_DEFAULT_URL,
  })
  return fakeWindow.calibraBridge
}

function bridgeMember(bridge: unknown, name: string): unknown {
  return typeof bridge === 'object' && bridge !== null
    ? Reflect.get(bridge, name)
    : undefined
}

describe('the e2e desktop bridge fake', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('implements exactly the methods of the bridge table', () => {
    const bridge = installFake()

    expect(typeof bridge).toBe('object')
    expect(Object.keys(bridge ?? {}).sort()).toEqual(
      [...desktopBridgeMethods].sort(),
    )
  })

  it('answers every invoke method in the shape its row declares', async () => {
    const bridge = installFake()

    for (const method of desktopBridgeInvokeMethods) {
      const member = bridgeMember(bridge, method)
      if (typeof member !== 'function') throw new Error(`${method} is missing`)

      const row = desktopBridge[method]
      const args = sampleArguments[method] ?? []
      expect(row.args.safeParse(args).success, `${method} arguments`).toBe(true)

      const answer = await Reflect.apply(member, bridge, args)
      const parsed = row.response.safeParse(answer)
      expect(parsed.success, `${method} response`).toBe(true)
    }
  })

  it('returns an unsubscribe function from every event method', () => {
    const bridge = installFake()

    for (const method of desktopBridgeEventMethods) {
      const member = bridgeMember(bridge, method)
      if (typeof member !== 'function') throw new Error(`${method} is missing`)

      const unsubscribe = Reflect.apply(member, bridge, [() => undefined])
      expect(typeof unsubscribe, method).toBe('function')
    }
  })

  it('places the local server where the shared default says', async () => {
    const bridge = installFake()
    const member = bridgeMember(bridge, 'getLocalEnvironmentBootstrap')
    if (typeof member !== 'function') throw new Error('missing')

    const bootstrap = await Reflect.apply(member, bridge, [])
    expect(bootstrap).toMatchObject({ httpBaseUrl: LOCAL_SERVER_DEFAULT_URL })
  })
})
