import { expect, type Page } from '@playwright/test'
import { LOCAL_SERVER_DEFAULT_URL } from '@calibra-facil/config/local-server-defaults'
import { isRecord } from '@calibra-facil/shared/record'
import {
  installDesktopBridgeFake,
  type OrganizationFixture,
} from './desktop-bridge-fake'

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
  await page.addInitScript(installDesktopBridgeFake, {
    activeOrganization,
    organizations,
    localServerUrl: LOCAL_SERVER_DEFAULT_URL,
  })
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

async function readJsonPayload(data: string | null) {
  if (!data) return {}

  const parsed = JSON.parse(data)
  return isRecord(parsed) ? parsed : {}
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
