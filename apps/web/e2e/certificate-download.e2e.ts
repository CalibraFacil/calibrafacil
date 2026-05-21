import { expect, test } from '@playwright/test'

import {
  labOrganization,
  mockDashboardOrganizations,
  mockLabSession,
  mockNotifications,
  mockPlanAccess,
  routeJson,
} from './helpers'

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
      const targetWindow = window as Window & {
        __openedUrls?: Array<{ url: string; target: string | null }>
      }

      targetWindow.__openedUrls = []
      window.open = (url?: string | URL, target?: string) => {
        targetWindow.__openedUrls?.push({
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
    await mockPlanAccess(page)
    await mockNotifications(page)
    await routeJson(page, '**/api/jobs/CAL-0007', {
      body: approvedJob(),
    })
    await routeJson(page, '**/api/jobs/7/download*', {
      body: { url: signedDownloadUrl },
      onRequest: (payload) => downloadRequests.push(payload),
    })

    await page.goto('/dashboard/jobs/CAL-0007')

    await expect(page.getByRole('heading', { name: 'CAL-0007' })).toBeVisible()
    await expect(page.getByText('Registro aprovado')).toBeVisible()

    const downloadButton = page.getByRole('button', {
      name: /baixar certificado/i,
    })
    await expect(downloadButton).toBeEnabled()
    await expect.poll(() => downloadRequests.length).toBeGreaterThan(0)

    await downloadButton.click()

    await expect.poll(() => downloadRequests.length).toBeGreaterThan(1)
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as Window & {
                __openedUrls?: Array<{ url: string; target: string | null }>
              }
            ).__openedUrls?.length ?? 0,
        ),
      )
      .toBe(1)

    const openedUrls = await page.evaluate(
      () =>
        (
          window as Window & {
            __openedUrls?: Array<{ url: string; target: string | null }>
          }
        ).__openedUrls ?? [],
    )
    expect(openedUrls).toContainEqual({
      url: signedDownloadUrl,
      target: '_blank',
    })
  })
})

function approvedJob() {
  return {
    id: 7,
    jobId: 'CAL-0007',
    status: 'APPROVED',
    customerName: 'Cliente Exemplo',
    assetName: 'Balança analítica',
    assetTag: 'BAL-01',
    serviceName: 'Calibração de massa',
    methodSnapshot: {
      methodId: 3,
      methodName: 'Método de massa',
      methodVersion: 2,
      dataFields: [],
      formulas: [],
      validations: [],
    },
    data: null,
    results: null,
    standardsSnapshot: [],
    assetSnapshot: {
      baseMeasurementUnit: 'g',
      specifications: {},
    },
    technicianName: 'Técnico Responsável',
    approvedBy: 'approver-1',
    approverName: 'Aprovador Técnico',
    approvedAt: '2026-05-20T10:00:00.000Z',
    performedAt: '2026-05-20T09:00:00.000Z',
    createdAt: '2026-05-19T10:00:00.000Z',
    certificateUrl: '/certificates/7.pdf',
    labelUrl: null,
  }
}
