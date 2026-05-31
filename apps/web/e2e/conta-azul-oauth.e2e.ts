import { expect, test } from '@playwright/test'

import {
  labOrganization,
  mockDashboardOrganizations,
  mockLabSession,
  mockNotifications,
  mockPlanAccess,
} from './helpers'

const CONTA_AZUL_AUTH_URL =
  'https://auth.contaazul.com/login?client_id=test&redirect_uri=cb&state=abc'

type SetupOptions = { hasEntitlement: boolean }

async function setupIntegrationsPage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: import('@playwright/test').Page,
  { hasEntitlement }: SetupOptions,
) {
  const oauthStartCalls: Array<Record<string, unknown>> = []

  const org = labOrganization({
    id: 'lab-1',
    name: 'Laboratório Central',
    // The integrations page resolves the role by matching the session user id,
    // so the member must carry userId: 'user-1' (the mocked session user).
    members: [{ userId: 'user-1', role: 'owner' }],
  })

  await mockLabSession(page)
  await mockDashboardOrganizations(page, {
    organizations: [org],
    activeOrganization: org,
  })
  await mockPlanAccess(page)
  await mockNotifications(page)

  await page.addInitScript(() => {
    window.localStorage.setItem('dashboard-active-org', 'lab-1')
  })

  // Single handler so the specific OAuth-start POST always wins over the list GET.
  await page.route('**/api/integrations**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname

    if (
      path.endsWith('/conta-azul/oauth/start') &&
      request.method() === 'POST'
    ) {
      const raw = request.postData()
      oauthStartCalls.push(raw ? JSON.parse(raw) : {})
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          authorizationUrl: CONTA_AZUL_AUTH_URL,
          expiresInSeconds: 600,
        }),
      })
      return
    }

    if (path.endsWith('/api/integrations') && request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [],
          billing: {
            hasFinancialIntegrations: hasEntitlement,
            planName: hasEntitlement ? 'Professional' : 'Standard',
          },
        }),
      })
      return
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    })
  })

  // Intercept the redirect target so window.location.assign doesn't leave the app.
  await page.route('https://auth.contaazul.com/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<html><body>conta azul auth stub</body></html>',
    })
  })

  return { oauthStartCalls }
}

test.describe('Conta Azul OAuth connect button', () => {
  test('does nothing when the org lacks the financial_integrations entitlement', async ({
    page,
  }) => {
    await setupIntegrationsPage(page, { hasEntitlement: false })

    await page.goto('/dashboard/settings/integrations')

    const connectButton = page.getByRole('button', {
      name: /Conectar Conta Azul/i,
    })
    await expect(connectButton).toBeVisible()
    // This is the reported "doesn't do anything": the button is disabled.
    await expect(connectButton).toBeDisabled()
  })

  test('starts the OAuth flow and redirects when entitled', async ({
    page,
  }) => {
    const { oauthStartCalls } = await setupIntegrationsPage(page, {
      hasEntitlement: true,
    })

    await page.goto('/dashboard/settings/integrations')

    const connectButton = page.getByRole('button', {
      name: /Conectar Conta Azul/i,
    })
    await expect(connectButton).toBeEnabled()

    await connectButton.click()

    // The click must hit the OAuth-start endpoint with the return path...
    await expect.poll(() => oauthStartCalls.length).toBeGreaterThan(0)
    expect(oauthStartCalls[0]).toMatchObject({
      returnTo: '/dashboard/settings/integrations',
    })

    // ...and then redirect the browser to the Conta Azul authorization URL.
    await expect.poll(() => page.url()).toContain('auth.contaazul.com')
  })
})
