import { expect, type Page } from '@playwright/test'

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

export async function mockPlanAccess(page: Page) {
  await routeJson(page, '**/api/billing/access*', {
    body: {
      entitlements: [],
      hasFinancial: false,
      hasFinancialModule: false,
      canManageBilling: false,
      hasApi: false,
      hasCustomDomain: false,
      hasCustomTemplates: false,
      hasSso: false,
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
  members: Array<{ role: string }>
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
