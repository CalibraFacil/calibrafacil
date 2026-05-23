import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('public auth routes', () => {
  it('does not expose self-service LAB registration routes', () => {
    const appRoot = process.cwd()
    const removedRoute = ['sign', 'up'].join('-')

    expect(existsSync(join(appRoot, 'src/routes', removedRoute))).toBe(false)
    expect(
      readFileSync(join(appRoot, 'src/routeTree.gen.ts'), 'utf8'),
    ).not.toContain(removedRoute)
  })
})
