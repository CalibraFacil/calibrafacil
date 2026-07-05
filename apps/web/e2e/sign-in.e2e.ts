import { expect, test } from '@playwright/test'

import { expectRequestPayload, routeJson } from './helpers'

test.describe('sign-in', () => {
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

    await expectRequestPayload(ssoRequests, {
      organizationSlug: 'lab-acreditado',
      email: 'tecnico@lab.test',
      redirectPath: '/dashboard/jobs',
    })
    await expect(page.getByText('Falha ao iniciar login via SSO')).toBeVisible()
  })
})
