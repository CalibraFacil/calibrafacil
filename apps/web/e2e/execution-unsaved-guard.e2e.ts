import { expect, test, type Page } from '@playwright/test'
import {
  buildExecutableJobDetail,
  buildJobMutationResponse,
} from '@calibra-facil/contracts/jobs-fixtures'

import {
  labOrganization,
  mockDashboardOrganizations,
  mockLabSession,
  mockNotifications,
  routeJson,
} from './helpers'

// The session helper signs in user-1; the draft key is org + job + user.
const DRAFT_KEY = 'calibra:execution-draft:v1:lab-1:7:user-1'

async function openExecutionPage(page: Page) {
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
  await routeJson(page, '**/api/standards?*', { body: { data: [] } })
  await routeJson(page, '**/api/jobs/CAL-0007/execute', {
    body: buildJobMutationResponse({ status: 'DRAFT' }),
  })

  await page.goto('/dashboard/jobs/CAL-0007/execute')
  await expect(page.getByRole('heading', { name: 'CAL-0007' })).toBeVisible({
    timeout: 15_000,
  })
}

function loadInput(page: Page) {
  return page
    .locator('[data-slot="field"]')
    .filter({ hasText: 'Carga' })
    .locator('input')
}

test.describe('execution unsaved-readings guard', () => {
  test('asks before leaving with unsaved readings and lets a clean page go', async ({
    page,
  }) => {
    await openExecutionPage(page)
    const jobsLink = page.locator('a[href="/dashboard/jobs"]').first()

    // Clean: navigating away is not intercepted.
    await jobsLink.click()
    await expect(page).toHaveURL(/\/dashboard\/jobs$/)

    await page.goto('/dashboard/jobs/CAL-0007/execute')
    await expect(page.getByRole('heading', { name: 'CAL-0007' })).toBeVisible({
      timeout: 15_000,
    })

    // Dirty: in-app navigation is blocked behind the confirm dialog.
    await loadInput(page).fill('12.5')
    await jobsLink.click()

    const dialog = page.getByRole('alertdialog')
    await expect(dialog.getByText('Sair sem salvar?')).toBeVisible()
    await expect(dialog.getByText(/há leituras não salvas/i)).toBeVisible()
    await expect(page).toHaveURL(/\/execute$/)

    await dialog.getByRole('button', { name: 'Continuar editando' }).click()
    await expect(dialog).toBeHidden()
    await expect(page).toHaveURL(/\/execute$/)
    await expect(loadInput(page)).toHaveValue('12.5')

    await jobsLink.click()
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Sair sem salvar' })
      .click()
    await expect(page).toHaveURL(/\/dashboard\/jobs$/)
  })

  test('arms the browser beforeunload prompt only while dirty', async ({
    page,
  }) => {
    await openExecutionPage(page)

    const prompts: string[] = []
    page.on('dialog', (dialog) => {
      prompts.push(dialog.type())
      void dialog.accept()
    })

    // Clean: no prompt on reload.
    await page.reload()
    await expect(page.getByRole('heading', { name: 'CAL-0007' })).toBeVisible({
      timeout: 15_000,
    })
    expect(prompts).toEqual([])

    await loadInput(page).fill('12.5')
    await page.reload()
    // The reload is prompted, and the unsaved draft is then offered back.
    await expect(
      page.getByRole('alertdialog').getByText('Restaurar rascunho não salvo?'),
    ).toBeVisible({ timeout: 15_000 })
    expect(prompts).toEqual(['beforeunload'])
  })

  test('autosaves a draft, offers it after a reload, and clears it on save', async ({
    page,
  }) => {
    await openExecutionPage(page)
    page.on('dialog', (dialog) => void dialog.accept())

    await loadInput(page).fill('12.5')
    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), DRAFT_KEY))
      .not.toBeNull()

    // Reload: the draft is offered, never applied on its own.
    await page.reload()
    const restore = page.getByRole('alertdialog')
    await expect(
      restore.getByText('Restaurar rascunho não salvo?'),
    ).toBeVisible()
    await restore.getByRole('button', { name: 'Restaurar' }).click()
    await expect(loadInput(page)).toHaveValue('12.5')

    // Saving releases the guard and removes the draft.
    await page.getByRole('button', { name: 'Salvar Rascunho' }).click()
    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), DRAFT_KEY))
      .toBeNull()

    // Discarding: type again, reload, discard.
    await loadInput(page).fill('13')
    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), DRAFT_KEY))
      .not.toBeNull()
    await page.reload()
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Descartar' })
      .click()
    await expect(loadInput(page)).toHaveValue('10')
    expect(
      await page.evaluate((key) => localStorage.getItem(key), DRAFT_KEY),
    ).toBeNull()
  })
})
