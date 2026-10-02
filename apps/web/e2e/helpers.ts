import { expect, type Page } from '@playwright/test'
import type {
  DesktopAuthFetchRequest,
  DesktopSecretName,
  DesktopSecretWrite,
} from '@calibra-facil/contracts'

export type JsonRouteOptions = {
  status?: number
  body: unknown
  onRequest?: (payload: Record<string, unknown>) => void
}

export async function routeJson(
  page: Page,
  url: string,
  { status = 200, body, onRequest }: JsonRouteOptions,
) {
  await page.route(url, async (route) => {
    const payload = await readJsonPayload(route.request().postData())
    onRequest?.(payload)

    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })
  })
}

export async function mockLabSession(page: Page) {
  await routeJson(page, '**/api/auth/lab/get-session*', {
    body: labSession(),
  })
}

export async function mockDashboardOrganizations(
  page: Page,
  {
    organizations,
    activeOrganization,
  }: {
    organizations: OrganizationFixture[]
    activeOrganization: OrganizationFixture | null
  },
) {
  await routeJson(page, '**/api/auth/lab/organization/list*', {
    body: organizations,
  })
  await routeJson(page, '**/api/auth/lab/organization/get-full-organization*', {
    body: activeOrganization,
  })
}

export async function mockNotifications(page: Page) {
  await routeJson(page, '**/api/notifications/unread-count*', {
    body: { count: 0 },
  })
  await routeJson(page, '**/api/notifications?*', {
    body: { data: [], total: 0 },
  })
}

export async function installDesktopBridge(
  page: Page,
  {
    activeOrganization = labOrganization(),
    organizations = [activeOrganization],
  }: {
    activeOrganization?: OrganizationFixture
    organizations?: OrganizationFixture[]
  } = {},
) {
  await page.addInitScript(
    ({
      activeOrganization,
      organizations,
    }: {
      activeOrganization: OrganizationFixture
      organizations: OrganizationFixture[]
    }) => {
      const responseHeaders: [string, string][] = [
        ['content-type', 'application/json'],
      ]
      const jsonResponse = (body: unknown, status = 200) => ({
        status,
        statusText: status >= 400 ? 'Error' : 'OK',
        headers: responseHeaders,
        body: JSON.stringify(body),
      })

      window.calibraBridge = {
        async authFetch(request: DesktopAuthFetchRequest) {
          const path = new URL(request.url).pathname

          if (path.endsWith('/api/auth/lab/get-session')) {
            return jsonResponse({
              user: {
                id: 'user-1',
                name: 'Técnico Laboratório',
                email: 'tecnico@lab.test',
                image: null,
                role: 'user',
              },
              session: {
                id: 'session-1',
                token: 'session-token',
                userId: 'user-1',
                activeOrganizationId: activeOrganization.id,
                impersonatedBy: null,
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
                expiresAt: '2026-01-02T00:00:00.000Z',
              },
            })
          }

          if (path.endsWith('/api/auth/lab/organization/list')) {
            return jsonResponse(organizations)
          }

          if (
            path.endsWith('/api/auth/lab/organization/get-full-organization')
          ) {
            return jsonResponse(activeOrganization)
          }

          if (path.endsWith('/api/auth/lab/organization/set-active')) {
            const body =
              typeof request.body === 'string' ? JSON.parse(request.body) : {}
            const target =
              organizations.find(
                (organization) =>
                  organization.id === body.organizationId ||
                  organization.slug === body.organizationSlug,
              ) ?? activeOrganization

            return jsonResponse(target)
          }

          if (path.endsWith('/api/notifications/unread-count')) {
            return jsonResponse({ count: 0 })
          }

          if (path.endsWith('/api/notifications')) {
            return jsonResponse({ data: [], total: 0 })
          }

          return jsonResponse({})
        },
        async getAppInfo() {
          return {
            name: 'CalibraFácil',
            version: 'e2e',
            platform: 'linux',
            arch: 'x64',
            isPackaged: false,
          }
        },
        async getLocalEnvironmentBootstrap() {
          return {
            appVersion: 'e2e',
            localServerVersion: 'e2e',
            deviceId: 'device-e2e',
            tenantId: null,
            organizationId: activeOrganization.id,
            unitId: null,
            userId: 'user-1',
            dbSchemaVersion: 1,
            syncEnabled: false,
            syncState: 'idle',
            httpBaseUrl: 'http://127.0.0.1:4317',
            localApiToken: 'local-e2e-token',
          }
        },
        async getSettings() {
          return { autoStartSync: false, updateChannel: 'stable' }
        },
        async setSettings() {
          return { autoStartSync: false, updateChannel: 'stable' }
        },
        async getSecretStatuses() {
          return []
        },
        async setSecret(secret: DesktopSecretWrite) {
          return {
            name: secret.name,
            stored: true,
            encryptionAvailable: true,
            updatedAt: null,
          }
        },
        async deleteSecret(name: DesktopSecretName) {
          return {
            name,
            stored: false,
            encryptionAvailable: true,
            updatedAt: null,
          }
        },
        async getSyncState() {
          return 'idle'
        },
        async getSyncStatus() {
          return {
            state: 'conflict',
            pendingOutboxCount: 1,
            conflictCount: 1,
            lastSyncedAt: '2026-05-10T12:00:00.000Z',
          }
        },
        onSyncStatus() {
          return () => undefined
        },
        async startSync() {
          return { ok: true }
        },
        async pauseSync() {
          return { ok: true }
        },
        async resumeSync() {
          return { ok: true }
        },
        async retrySync() {
          return { ok: true }
        },
        async wakeSync() {
          return { ok: true }
        },
        onDeepLink() {
          return () => undefined
        },
        async notifyDeepLinkReady() {
          return true
        },
        async publishNotifications() {
          return true
        },
        async revealFile() {
          return true
        },
        onHistoryCommand() {
          return () => undefined
        },
        async activateLocalPartition() {
          // The e2e fixture runs a single account, so activation is a no-op
          // that reports the partition already open — never a switch, which
          // would have the app clear its caches mid-scenario.
          return {
            status: 'active' as const,
            partition: {
              userId: 'user-1',
              organizationId: activeOrganization.id,
            },
            switched: false,
          }
        },
        async pickFile() {
          return null
        },
        async pickFolder() {
          return null
        },
        async saveFile() {
          return null
        },
        async saveCertificatePdf() {
          return null
        },
        async openExternal() {
          return true
        },
        async exportSupportBundle() {
          return null
        },
        async getUpdateState() {
          return { status: 'idle' }
        },
        onUpdateState() {
          return () => undefined
        },
        async checkForUpdate() {
          return { status: 'idle' }
        },
        async downloadUpdate() {
          return { status: 'idle' }
        },
        async installUpdate() {
          return { status: 'idle' }
        },
      }
    },
    { activeOrganization, organizations },
  )
}

export async function mockLocalSession(page: Page) {
  await routeJson(page, '**/api/local/session', {
    body: {
      data: {
        serverTime: '2026-05-10T12:00:00.000Z',
        user: {
          id: 'user-1',
          name: 'Técnico Laboratório',
          email: 'tecnico@lab.test',
        },
        organization: {
          id: 'lab-1',
          type: 'LAB',
        },
        activeUnits: [],
        permissions: {
          role: 'admin',
          unitRole: null,
          activeUnitId: null,
          accessibleUnitIds: [],
          canAccessAllUnits: true,
        },
        featureFlags: {
          offlineApprovals: true,
          offlineCertificatePublication: false,
        },
        syncCursor: 'cursor-1',
        publishedMethods: [],
        assetTypes: [],
        customers: [],
        assets: [],
        services: [],
        standards: [],
        environmentalLimits: [],
        jobs: [],
        serviceOrders: [],
      },
    },
  })
}

export function labOrganization(
  overrides: Partial<OrganizationFixture> = {},
): OrganizationFixture {
  const id = overrides.id ?? 'lab-1'

  return {
    id,
    name: overrides.name ?? 'Laboratório Central',
    slug: overrides.slug ?? id,
    type: 'LAB',
    members: [{ role: 'admin' }],
    ...overrides,
  }
}

export function clientOrganization(
  overrides: Partial<OrganizationFixture> = {},
): OrganizationFixture {
  const id = overrides.id ?? 'client-1'

  return {
    id,
    name: overrides.name ?? 'Cliente Portal',
    slug: overrides.slug ?? id,
    type: 'CLIENT',
    members: [{ role: 'member' }],
    ...overrides,
  }
}

export async function expectRequestPayload(
  requests: Array<Record<string, unknown>>,
  payload: Record<string, unknown>,
) {
  await expect.poll(() => requests.length).toBeGreaterThan(0)
  expect(requests[0]).toMatchObject(payload)
}

type OrganizationFixture = {
  id: string
  name: string
  slug: string
  type: 'LAB' | 'CLIENT'
  members: Array<{ role: string; userId?: string; user?: { id: string } }>
}

async function readJsonPayload(data: string | null) {
  if (!data) return {}

  const parsed = JSON.parse(data)
  return isRecord(parsed) ? parsed : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function labSession() {
  return {
    user: {
      id: 'user-1',
      name: 'Técnico Laboratório',
      email: 'tecnico@lab.test',
      image: null,
      role: 'user',
    },
    session: {
      id: 'session-1',
      token: 'session-token',
      userId: 'user-1',
      activeOrganizationId: 'lab-1',
      impersonatedBy: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
      updatedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
      expiresAt: new Date('2026-01-02T00:00:00.000Z').toISOString(),
    },
  }
}
