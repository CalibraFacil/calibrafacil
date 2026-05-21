import { expect, test, type Page } from '@playwright/test'

test.describe('sign-in', () => {
  test('keeps failed lab credentials on the sign-in page', async ({ page }) => {
    const signInRequests: Array<Record<string, unknown>> = []

    await routeJson(page, '**/api/auth/lab/sign-in/email', {
      status: 401,
      body: { message: 'Credenciais inválidas' },
      onRequest: (payload) => signInRequests.push(payload),
    })

    await page.goto('/sign-in?redirect=/dashboard/jobs')

    await expect(
      page.getByRole('heading', { name: 'Entre em sua conta' }),
    ).toBeVisible()

    await page.getByLabel('Email', { exact: true }).fill('tecnico@lab.test')
    await page.getByLabel('Senha').fill('senha-incorreta')
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()

    await expect.poll(() => signInRequests.length).toBe(1)
    expect(signInRequests[0]).toMatchObject({
      email: 'tecnico@lab.test',
      password: 'senha-incorreta',
    })
    await expect(page.getByText('Credenciais inválidas')).toBeVisible()
    await expect(page).toHaveURL(/\/sign-in/)
  })

  test('starts SSO with organization, email hint, and redirect path', async ({
    page,
  }) => {
    const ssoRequests: Array<Record<string, unknown>> = []

    await routeJson(page, '**/api/sso/start', {
      status: 200,
      body: {},
      onRequest: (payload) => ssoRequests.push(payload),
    })

    await page.goto('/sign-in?redirect=/dashboard/jobs')

    await expect(
      page.getByRole('button', { name: 'Entrar com SSO' }),
    ).toBeDisabled()

    await page.getByLabel('Slug da organização').fill('lab-acreditado')
    await page.getByLabel('Email corporativo').fill('tecnico@lab.test')
    await page.getByRole('button', { name: 'Entrar com SSO' }).click()

    await expect.poll(() => ssoRequests.length).toBe(1)
    expect(ssoRequests[0]).toMatchObject({
      organizationSlug: 'lab-acreditado',
      email: 'tecnico@lab.test',
      redirectPath: '/dashboard/jobs',
    })
    await expect(page.getByText('Falha ao iniciar login via SSO')).toBeVisible()
  })
})

async function routeJson(
  page: Page,
  url: string,
  options: {
    status: number
    body: unknown
    onRequest?: (payload: Record<string, unknown>) => void
  },
) {
  await page.route(url, async (route) => {
    const payload = await readJsonPayload(route.request().postData())
    options.onRequest?.(payload)

    await route.fulfill({
      status: options.status,
      contentType: 'application/json',
      body: JSON.stringify(options.body),
    })
  })
}

async function readJsonPayload(data: string | null) {
  if (!data) return {}

  const parsed = JSON.parse(data)
  return isRecord(parsed) ? parsed : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
