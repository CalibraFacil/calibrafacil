import { expect, test } from '@playwright/test'

import {
  expectRequestPayload,
  installDesktopBridge,
  labOrganization,
  mockLocalSession,
  routeJson,
} from './helpers'

test.describe('sync conflicts', () => {
  test('shows conflict diffs and resolves a local conflict from desktop', async ({
    page,
  }) => {
    const conflict = {
      id: 'conflict:customer:local-1:event-1',
      eventId: 'event-1',
      entityType: 'customer',
      entityId: 'customer:local-1',
      conflictType: 'concurrent_update',
      status: 'open',
      createdAt: '2026-05-10T12:00:00.000Z',
      localPayload: {
        operation: 'update_customer',
        name: 'Laboratório Exemplo',
        email: 'lab@exemplo.test',
      },
      remotePayload: {
        operation: 'update_customer',
        name: 'Laboratório Exemplo Ltda',
        email: 'lab@exemplo.test',
      },
    }
    const resolveRequests: Array<Record<string, unknown>> = []

    await installDesktopBridge(page, {
      activeOrganization: labOrganization({
        id: 'lab-1',
        name: 'Laboratório Desktop',
        slug: 'lab-desktop',
      }),
    })
    await mockLocalSession(page)
    await routeJson(page, '**/api/local/sync/conflicts*', {
      body: {
        data: [conflict],
        total: 1,
      },
    })
    await routeJson(page, '**/api/local/sync/conflicts/**/resolve', {
      body: {
        data: {
          ...conflict,
          status: 'ignored',
          resolvedAt: '2026-05-10T12:05:00.000Z',
        },
      },
      onRequest: (payload) => resolveRequests.push(payload),
    })

    await page.goto('/#/dashboard/sync/conflicts')

    await expect(page.getByText('Cliente · customer:local-1')).toBeVisible()
    // The raw JSON payloads below the diff repeat these values, so match the
    // diff cells by their whole text.
    await expect(page.getByText('Nome', { exact: true })).toBeVisible()
    await expect(
      page.getByText('Laboratório Exemplo', { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByText('Laboratório Exemplo Ltda', { exact: true }),
    ).toBeVisible()
    await expect(page.getByText('Payload bruto · Local')).toBeVisible()
    // The edit action is a router link rendered through the Button component,
    // which exposes it with the `button` role.
    await expect(
      page.getByRole('button', { name: 'Editar antes de tentar' }),
    ).toHaveAttribute(
      'href',
      /\/dashboard\/clients\/customer%3Alocal-1\/info.*syncConflictId=/,
    )

    await page.getByRole('button', { name: 'Manter nuvem' }).click()

    await expectRequestPayload(resolveRequests, { status: 'ignored' })
  })
})
