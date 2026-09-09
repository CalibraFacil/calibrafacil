import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Self-serve sign-up was deliberately introduced in 2026-09: a laboratory can
 * now open its own account from the pricing page. What did NOT change is the
 * rule underneath the old "no public registration" invariant — an account is
 * only opened for a laboratory that owns its e-mail domain, and it still costs
 * a click on a link sent to that mailbox.
 *
 * These assertions keep that shape from eroding into "anyone with an e-mail".
 */
describe('public auth routes', () => {
  const appRoot = process.cwd()
  const signUpRoute = ['sign', 'up'].join('-')

  it('exposes exactly one self-serve registration route', () => {
    const routeTree = readFileSync(
      join(appRoot, 'src/routeTree.gen.ts'),
      'utf8',
    )

    const declarations = routeTree.match(/path: '\/sign-up\/'/g) ?? []
    expect(declarations).toHaveLength(1)
  })

  it('keeps registration behind the corporate-domain policy', () => {
    const form = readFileSync(
      join(appRoot, `src/features/auth/${signUpRoute}-forms.ts`),
      'utf8',
    )

    // The page must validate through the shared schema, which is where the
    // "own domain" rule lives. A hand-rolled check here would drift from the
    // API's and let a Gmail address through the browser.
    expect(form).toContain('SelfServeSignupSchema')
  })

  it('never asks for or sets a password', () => {
    const page = readFileSync(
      join(appRoot, `src/features/auth/${signUpRoute}-page.tsx`),
      'utf8',
    )

    // Lab access is passwordless by policy; sign-up must not be the back door
    // that reintroduces credentials. (Prose about there being no password is
    // fine — an input is not.)
    expect(page).not.toContain('type="password"')
    expect(page).not.toContain('new-password')
    expect(page).not.toContain('current-password')
  })
})
