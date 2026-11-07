import type {
  DesktopAuthFetchRequest,
  DesktopSecretName,
} from '@calibra-facil/contracts'

export type OrganizationFixture = {
  id: string
  name: string
  slug: string
  type: 'LAB' | 'CLIENT'
  members: Array<{ role: string; userId?: string; user?: { id: string } }>
}

export type DesktopBridgeFixtures = {
  activeOrganization: OrganizationFixture
  organizations: OrganizationFixture[]
  /** Where the fake says the local server listens. */
  localServerUrl: string
}

/**
 * Installs a fake `window.calibraBridge` in the page: the surface the Electron
 * shell exposes, answering from fixtures so the web app runs in a plain browser.
 *
 * Playwright serializes this function into the page (`page.addInitScript`), so
 * it is self-contained: no imports at runtime, everything it needs arrives
 * through `fixtures`. `CalibraBridge` is derived from the bridge table in
 * `@calibra-facil/contracts`, so the compiler rejects a fake that lacks a
 * method; `src/runtime/desktop-bridge-fake.test.ts` also runs it against the
 * table's response schemas.
 */
export function installDesktopBridgeFake({
  activeOrganization,
  organizations,
  localServerUrl,
}: DesktopBridgeFixtures) {
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

      if (path.endsWith('/api/auth/lab/organization/get-full-organization')) {
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

      // `units.getDashboardUnits` is cloud-only, so the hybrid desktop
      // client asks the cloud for it through this bridge. The shell reads
      // `data` straight away, so the fallback `{}` below would crash it.
      if (path.endsWith('/api/units')) {
        return jsonResponse({
          activeUnitId: null,
          activeUnitName: null,
          selectedUnitScope: 'all',
          canAccessAllUnits: true,
          data: [],
        })
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
        httpBaseUrl: localServerUrl,
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
    async forgetOfflineAccess() {
      return true
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
}
