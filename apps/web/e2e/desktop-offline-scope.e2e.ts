import { expect, test } from '@playwright/test'

import {
  installDesktopBridge,
  labOrganization,
  mockLocalSession,
  routeJson,
} from './helpers'

test.describe('desktop offline scope (Q13)', () => {
  test('keeps field capture reachable and marks online-only areas "disponível apenas online" while disconnected', async ({
    page,
    context,
  }) => {
    await installDesktopBridge(page, {
      activeOrganization: labOrganization({
        id: 'lab-1',
        name: 'Laboratório Desktop',
        slug: 'lab-desktop',
      }),
    })
    await mockLocalSession(page)
    await routeJson(page, '**/api/local/sync/conflicts*', {
      body: { data: [], total: 0 },
    })
    await routeJson(page, '**/api/local/sync/dead-events*', {
      body: { data: [], total: 0 },
    })

    await page.goto('/#/dashboard/sync/conflicts')
    await expect(
      page.getByRole('heading', { name: 'Conflitos de sincronização' }),
    ).toBeVisible()

    await context.setOffline(true)

    // An area outside the offline scope is blocked, with a way back.
    await page.evaluate(() => {
      window.location.hash = '#/dashboard/finance'
    })
    await expect(
      page.getByRole('heading', { name: 'Disponível apenas online' }),
    ).toBeVisible()
    await expect(
      page.getByRole('navigation', { name: 'Disponível offline' }),
    ).toBeVisible()
    await expect(page.getByText(/Esta área precisa da conexão/)).toBeVisible()

    // Anything that is not on the offline allowlist is blocked: new routes default to online-only.
    await page.evaluate(() => {
      window.location.hash = '#/dashboard/personnel'
    })
    await expect(
      page.getByRole('heading', { name: 'Disponível apenas online' }),
    ).toBeVisible()

    // Field capture stays on screen.
    await page.evaluate(() => {
      window.location.hash = '#/dashboard/sync/conflicts'
    })
    await expect(
      page.getByRole('heading', { name: 'Conflitos de sincronização' }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Disponível apenas online' }),
    ).toHaveCount(0)
  })
})
