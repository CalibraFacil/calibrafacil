import { expect, test } from '@playwright/test'
import {
  buildApprovedJobDetail,
  buildJobDownloadUrlResponse,
} from '@calibra-facil/contracts/jobs-fixtures'

import {
  labOrganization,
  mockDashboardOrganizations,
  mockLabSession,
  mockNotifications,
  routeJson,
} from './helpers'

declare global {
  interface Window {
    __openedUrls?: Array<{ url: string; target: string | null }>
  }
}

test.describe('certificate distribution', () => {
  test('opens a fresh signed certificate download URL from an approved job', async ({
    page,
  }) => {
    const lab = labOrganization({
      id: 'lab-1',
      name: 'Laboratório Central',
      slug: 'lab-central',
    })
    const signedDownloadUrl =
      'https://signed-download.example.test/certificates/7.pdf'
    const downloadRequests: Array<Record<string, unknown>> = []

    await page.addInitScript(() => {
      window.__openedUrls = []
      window.open = (url?: string | URL, target?: string) => {
        window.__openedUrls?.push({
          url: url ? String(url) : '',
          target: target ?? null,
        })

        return null
      }
    })

    await mockLabSession(page)
    await mockDashboardOrganizations(page, {
      organizations: [lab],
      activeOrganization: lab,
    })
    await mockNotifications(page)
    await routeJson(page, '**/api/jobs/CAL-0007', {
      body: buildApprovedJobDetail({
        customerName: 'Cliente Exemplo',
      }),
    })
    await routeJson(page, '**/api/jobs/7/download*', {
      body: buildJobDownloadUrlResponse(signedDownloadUrl),
      onRequest: (payload) => downloadRequests.push(payload),
    })

    await page.goto('/dashboard/jobs/CAL-0007')

    await expect(page.getByRole('heading', { name: 'CAL-0007' })).toBeVisible()
    // The approval status badge in the record header; the history list below
    // also contains an "Aprovado" entry, so match the badge itself.
    await expect(
      page.locator('[data-slot="badge"]', { hasText: /^Aprovado$/ }),
    ).toBeVisible()

    const downloadButton = page.getByRole('button', {
      name: /baixar certificado/i,
    })
    await expect(downloadButton).toBeEnabled()
    await expect.poll(() => downloadRequests.length).toBeGreaterThan(0)

    await downloadButton.click()

    await expect.poll(() => downloadRequests.length).toBeGreaterThan(1)
    await expect
      .poll(() => page.evaluate(() => window.__openedUrls?.length ?? 0))
      .toBe(1)

    const openedUrls = await page.evaluate(() => window.__openedUrls ?? [])
    expect(openedUrls).toContainEqual({
      url: signedDownloadUrl,
      target: '_blank',
    })
  })
})
