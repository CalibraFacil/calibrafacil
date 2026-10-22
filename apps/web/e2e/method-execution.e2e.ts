import { expect, test } from '@playwright/test'
import {
  buildExecutableJobDetail,
  buildJobMutationResponse,
} from '@calibra-facil/contracts/jobs-fixtures'
import { buildStandardsList } from '@calibra-facil/contracts/standards-fixtures'

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
      body: buildExecutableJobDetail(),
    })
    await routeJson(page, '**/api/standards?*', {
      body: buildStandardsList([]),
    })
    await routeJson(page, '**/api/jobs/CAL-0007/submit', {
      body: buildJobMutationResponse(
        { status: 'REVIEW' },
        'Calibração enviada para revisão',
      ),
      onRequest: (payload) => submitRequests.push(payload),
    })

    await page.goto('/dashboard/jobs/CAL-0007/execute')

    await expect(page.getByRole('heading', { name: 'CAL-0007' })).toBeVisible()
    await expect(page.getByText('Cliente Exemplo · Balança')).toBeVisible()

    // Submitting requires the execution date, which a fresh draft does not have.
    await page.getByRole('button', { name: 'Abrir calendário' }).click()
    await page.getByRole('button', { name: 'Hoje' }).click()
    await expect(page.getByRole('textbox', { name: 'Data' })).not.toHaveValue(
      '',
    )
    await page.keyboard.press('Escape')

    const submitButton = page.getByRole('button', {
      name: 'Enviar para Revisão',
    })
    await expect(submitButton).toBeEnabled()
    await submitButton.click()

    await expectRequestPayload(submitRequests, {
      selectedStandardIds: [],
      data: { load: 10 },
      results: {},
      calibrationLocation: {
        type: 'lab',
        addressText: 'Rua Laboratório',
        notes: null,
      },
      performedAt: expect.any(String),
    })
    await expect(page).toHaveURL(/\/dashboard\/jobs/)
  })
})
