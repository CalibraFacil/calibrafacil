import { expect, test } from '@playwright/test'

import {
  clientOrganization,
  expectRequestPayload,
  labOrganization,
  mockDashboardOrganizations,
  mockLabSession,
  mockPlanAccess,
  routeJson,
} from './helpers'

test.describe('dashboard bootstrap', () => {
  test('restores the stored LAB organization before rendering child routes', async ({
    page,
  }) => {
    const labOne = labOrganization({
      id: 'lab-1',
      name: 'Laboratório Matriz',
      slug: 'lab-matriz',
    })
    const labTwo = labOrganization({
      id: 'lab-2',
      name: 'Laboratório Filial',
      slug: 'lab-filial',
    })
    const setActiveRequests: Array<Record<string, unknown>> = []

    await mockLabSession(page)
    await mockDashboardOrganizations(page, {
      organizations: [clientOrganization(), labOne, labTwo],
      activeOrganization: labOne,
    })
    await mockPlanAccess(page)
    await routeJson(page, '**/api/auth/lab/organization/set-active*', {
      body: labTwo,
      onRequest: (payload) => setActiveRequests.push(payload),
    })
    await page.addInitScript(() => {
      window.localStorage.setItem('dashboard-active-org', 'lab-2')
    })

    await page.goto('/dashboard/jobs')

    await expectRequestPayload(setActiveRequests, {
      organizationId: 'lab-2',
    })
    await expect(page.locator('main .animate-pulse').first()).toBeVisible()
    await expect(page).toHaveURL(/\/dashboard\/jobs/)
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.localStorage.getItem('dashboard-active-org'),
        ),
      )
      .toBe('lab-2')
  })
})
