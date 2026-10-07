import { expect, test } from '@playwright/test'

import { signInLinkFor } from './inbox'

// A customer of the demo laboratory signs in to the client portal with the
// e-mailed link and sees their instruments.
const portalURL = process.env.STACK_PORTAL_URL ?? 'http://localhost:5174'
const email =
  process.env.STACK_PORTAL_EMAIL ?? 'qualidade@coxilhabranca.example'

test('a customer signs in to the portal', async ({ page }) => {
  const since = new Date(Date.now() - 1000)
  await page.goto(`${portalURL}/sign-in`)
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Receber link de acesso' }).click()

  await page.goto(await signInLinkFor(email, since))
  await page.getByRole('button', { name: 'Entrar no portal' }).click()

  await expect(page).not.toHaveURL(/sign-in|magic-link/)
  await expect(page.getByText('Instrumentos').first()).toBeVisible()
})
