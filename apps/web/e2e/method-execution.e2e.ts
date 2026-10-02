import { expect, test } from '@playwright/test'

import {
  expectRequestPayload,
  labOrganization,
  mockDashboardOrganizations,
  mockLabSession,
  mockNotifications,
  routeJson,
} from './helpers'

test.describe('method execution', () => {
  test('submits normalized execution data for review', async ({ page }) => {
    const submitRequests: Array<Record<string, unknown>> = []
    const lab = labOrganization({
      id: 'lab-1',
      name: 'Laboratório Central',
      slug: 'lab-central',
    })

    await mockLabSession(page)
    await mockDashboardOrganizations(page, {
      organizations: [lab],
      activeOrganization: lab,
    })
    await mockNotifications(page)
    await routeJson(page, '**/api/jobs/CAL-0007', {
      body: executableJob(),
    })
    await routeJson(page, '**/api/standards?*', {
      body: { data: [] },
    })
    await routeJson(page, '**/api/jobs/CAL-0007/submit', {
      body: { id: 7, jobId: 'CAL-0007', status: 'REVIEW' },
      onRequest: (payload) => submitRequests.push(payload),
    })

    await page.goto('/dashboard/jobs/CAL-0007/execute')

    await expect(page.getByRole('heading', { name: 'CAL-0007' })).toBeVisible()
    await expect(page.getByText('Cliente Exemplo · Balança')).toBeVisible()

    await page.getByRole('button', { name: /enviar para revisão/i }).click()

    await expectRequestPayload(submitRequests, {
      selectedStandardIds: [],
      data: { load: 10 },
      results: {},
      calibrationLocation: {
        type: 'lab',
        addressText: 'Rua Laboratório',
        notes: null,
      },
    })
    await expect(page).toHaveURL(/\/dashboard\/jobs/)
  })
})

function executableJob() {
  return {
    id: 7,
    jobId: 'CAL-0007',
    status: 'DRAFT',
    customerName: 'Cliente Exemplo',
    assetName: 'Balança',
    assetTag: 'BAL-01',
    assetTypeId: 1,
    unitId: null,
    serviceName: 'Calibração',
    methodSnapshot: {
      methodId: 1,
      methodName: 'Método de Massa',
      methodVersion: 1,
      dataFields: [
        {
          key: 'load',
          label: 'Carga',
          type: 'number',
          required: true,
          unit: 'g',
        },
      ],
      formulas: [],
      validations: [],
      uncertaintyParams: [],
    },
    data: { load: 10 },
    results: null,
    standardsSnapshot: [],
    assetSnapshot: {
      assetId: 1,
      assetTypeId: 1,
      assetTypeName: 'Balança',
      assetTypeSlug: 'scale',
      name: 'Balança',
      tag: 'BAL-01',
      serialNumber: 'SN-01',
      manufacturer: null,
      model: null,
      specifications: {},
      capturedAt: '2026-05-20T00:00:00.000Z',
    },
    calibrationLocationSnapshot: {
      type: 'lab',
      addressText: 'Rua Laboratório',
    },
  }
}
