import { expect, test } from '@playwright/test'

// The seeded demo laboratory, through the real API: every main page renders
// without a server error or an uncaught exception, and an issued certificate
// downloads as a PDF from storage.

const pages = [
  '/dashboard',
  '/dashboard/jobs',
  '/dashboard/clients',
  '/dashboard/assets',
  '/dashboard/service-orders',
  '/dashboard/requests',
  '/dashboard/visits',
  '/dashboard/nc',
  '/dashboard/capa',
  '/dashboard/spc',
  '/dashboard/methods',
  '/dashboard/standards',
  '/dashboard/services',
  '/dashboard/personnel',
  '/dashboard/reports',
  '/dashboard/finance',
]

test('the dashboard shows the seeded laboratory', async ({ page }) => {
  await page.goto('/dashboard')
  await expect(
    page.getByRole('heading', { name: 'Operação do laboratório' }),
  ).toBeVisible()
  await expect(page.getByText('Calibrações em aberto')).toBeVisible()
  await expect(page.getByText('Aprovadas no mês')).toBeVisible()
})

for (const path of pages) {
  test(`${path} renders`, async ({ page }) => {
    const serverErrors: string[] = []
    const pageErrors: string[] = []
    page.on('response', (response) => {
      if (response.url().includes('/api/') && response.status() >= 500) {
        serverErrors.push(`${response.status()} ${response.url()}`)
      }
    })
    page.on('pageerror', (error) => pageErrors.push(error.message))

    await page.goto(path)
    await page.waitForLoadState('networkidle')

    await expect(
      page.locator('main').getByRole('heading').first(),
    ).toBeVisible()
    expect(serverErrors).toEqual([])
    expect(pageErrors).toEqual([])
  })
}

test('an issued certificate downloads as a PDF', async ({ page }) => {
  await page.goto('/dashboard')
  const listing = await page.request.get('/api/jobs?status=APPROVED&limit=20')
  expect(listing.ok()).toBe(true)
  const body: unknown = await listing.json()
  const ids =
    typeof body === 'object' &&
    body !== null &&
    'data' in body &&
    Array.isArray(body.data)
      ? body.data.flatMap((job: unknown) =>
          typeof job === 'object' &&
          job !== null &&
          'id' in job &&
          typeof job.id === 'number'
            ? [job.id]
            : [],
        )
      : []
  expect(ids.length).toBeGreaterThan(0)

  // The newest approvals carry a rendered certificate; older seeded ones may not.
  let signedUrl: string | undefined
  for (const id of ids) {
    const download = await page.request.get(`/api/jobs/${id}/download`)
    if (!download.ok()) continue
    const link: unknown = await download.json()
    if (
      typeof link === 'object' &&
      link !== null &&
      'url' in link &&
      typeof link.url === 'string'
    ) {
      signedUrl = link.url
      break
    }
  }
  if (!signedUrl)
    throw new Error('No approved job has a downloadable certificate')

  const pdf = await page.request.get(signedUrl)
  expect(pdf.ok()).toBe(true)
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-')
})
