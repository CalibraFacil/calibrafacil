import { expect, test } from '@playwright/test'

import { signInLinkFor } from './inbox'

const email = process.env.STACK_LAB_EMAIL ?? 'admin@laboratorio.test'

test('signs in to the lab with the e-mailed link', async ({ page }) => {
  // Mailpit stamps messages in whole seconds.
  const since = new Date(Date.now() - 1000)
  await page.goto('/sign-in')
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByRole('button', { name: 'Receber link de acesso' }).click()

  await page.goto(await signInLinkFor(email, since))
  await page.getByRole('button', { name: 'Entrar no CalibraFácil' }).click()

  // A new laboratory may land on onboarding rather than the dashboard.
  await expect(page).not.toHaveURL(/\/(sign-in|magic-link)/)
  await page.context().storageState({
    path: 'test-results/stack/.auth/lab.json',
  })
})
