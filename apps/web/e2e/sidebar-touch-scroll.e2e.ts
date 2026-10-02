import { expect, test } from '@playwright/test'

import {
  clientOrganization,
  labOrganization,
  mockDashboardOrganizations,
  mockLabSession,
} from './helpers'

test.use({
  viewport: { width: 390, height: 700 },
  hasTouch: true,
  isMobile: true,
})

/**
 * Regression test: a touch-drag that starts on a sidebar nav link must scroll
 * the sheet, not dismiss it. The link's prewarm-on-touch intent settles
 * through a same-location `onResolved` router event; SidebarMobileAutoClose
 * used to treat any `onResolved` as a navigation and closed the sheet under
 * the user's finger mid-scroll.
 */
test('touch-drag starting on a sidebar link scrolls without closing the sheet', async ({
  page,
}) => {
  const lab = labOrganization()
  await mockLabSession(page)
  await mockDashboardOrganizations(page, {
    organizations: [clientOrganization(), lab],
    activeOrganization: lab,
  })

  await page.goto('/dashboard')
  await page.locator('[data-sidebar="trigger"]').click()

  const sheet = page.locator('[data-mobile="true"]')
  await expect(sheet).toBeVisible()

  const link = sheet.locator('a[href]').nth(3)
  const box = await link.boundingBox()
  if (!box) throw new Error('sidebar link has no bounding box')
  const x = box.x + box.width / 2
  const startY = box.y + box.height / 2

  // Playwright's touchscreen API has no drag, so dispatch the gesture via CDP
  // (the suite only runs on chromium). Total drag time must comfortably exceed
  // the 120ms prewarm-intent debounce that used to trigger the dismissal.
  const client = await page.context().newCDPSession(page)
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y: startY }],
  })
  for (let i = 1; i <= 12; i++) {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: startY - i * 12 }],
    })
    await page.waitForTimeout(16)
  }
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  })

  // Give the debounced prewarm time to settle before asserting.
  await page.waitForTimeout(400)

  await expect(sheet).toBeVisible()
  await expect(page).toHaveURL(/\/dashboard$/)
})
