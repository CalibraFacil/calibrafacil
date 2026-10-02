import { expect, test } from '@playwright/test'
import {
  labOrganization,
  mockDashboardOrganizations,
  mockLabSession,
} from './helpers'

test('command palette supports keyboard navigation and organization selection', async ({
  page,
}, testInfo) => {
  await mockLabSession(page)
  await mockDashboardOrganizations(page, {
    organizations: [
      labOrganization({
        id: 'lab-1',
        name: 'Laboratório Matriz',
        slug: 'matriz',
      }),
      labOrganization({
        id: 'lab-2',
        name: 'Laboratório Filial',
        slug: 'filial',
      }),
    ],
    activeOrganization: labOrganization({
      id: 'lab-1',
      name: 'Laboratório Matriz',
      slug: 'matriz',
    }),
  })
  await page.goto('/dashboard/jobs')
  await expect(
    page.getByRole('button', { name: 'Buscar... Ctrl+K' }),
  ).toBeVisible()
  await page.keyboard.press('Control+k')
  const dialog = page.getByRole('dialog', { name: 'Paleta de Comandos' })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('kbd')).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('command-palette.png') })
  await dialog.getByRole('combobox').fill('Trocar')
  await page.keyboard.press('Enter')
  await expect(dialog.getByText('Laboratório Filial')).toBeVisible()
  await expect(dialog.getByRole('combobox')).toBeFocused()
  await page.screenshot({
    path: testInfo.outputPath('command-palette-organizations.png'),
  })
  await dialog.getByRole('button', { name: 'Voltar' }).click()
  await dialog.getByText('Buscar Padrão...').click()
  await expect(
    dialog.getByText('Digite pelo menos 2 caracteres para buscar.'),
  ).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
})
