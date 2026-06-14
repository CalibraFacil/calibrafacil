import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const dashboardRoutesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../routes/dashboard',
)

const redirectOnlyDashboardRoutes = new Set([
  'clients/$id/index.tsx',
  'clients/groups/$groupId/index.tsx',
  'finance/documents/index.tsx',
  'finance/receipts.tsx',
  'internal/customer-success.tsx',
  'settings/billing.tsx',
  'settings/branding.tsx',
])

describe('dashboard route head metadata', () => {
  it('requires every renderable dashboard page route to define a head title', () => {
    const missingHeadRoutes = dashboardRouteFiles()
      .filter((filePath) => isRenderablePageRoute(filePath))
      .filter((filePath) => !readFileSync(filePath, 'utf8').includes('head:'))
      .map(relativeDashboardRoute)

    expect(missingHeadRoutes).toEqual([])
  })
})

function dashboardRouteFiles(dir = dashboardRoutesDir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const filePath = join(dir, name)
    if (statSync(filePath).isDirectory()) {
      return dashboardRouteFiles(filePath)
    }
    return filePath.endsWith('.tsx') ? [filePath] : []
  })
}

function isRenderablePageRoute(filePath: string) {
  const routePath = relativeDashboardRoute(filePath)

  return (
    !routePath.endsWith('route.tsx') &&
    !redirectOnlyDashboardRoutes.has(routePath)
  )
}

function relativeDashboardRoute(filePath: string) {
  return relative(dashboardRoutesDir, filePath).split(sep).join('/')
}
