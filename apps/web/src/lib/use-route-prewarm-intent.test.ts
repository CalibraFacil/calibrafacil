import { describe, expect, it } from 'vitest'

import { resolvePrewarmUrl } from './use-route-prewarm-intent'

describe('resolvePrewarmUrl', () => {
  const currentHref = 'https://app.calibrafacil.com/dashboard'

  it('does not prewarm routes in the desktop runtime', () => {
    expect(
      resolvePrewarmUrl('/dashboard/standards', currentHref, {
        isDesktop: true,
      }),
    ).toBeNull()
  })

  it('does not prewarm external links', () => {
    expect(
      resolvePrewarmUrl('https://docs.calibrafacil.com', currentHref),
    ).toBeNull()
  })

  it('resolves internal web routes for prewarm', () => {
    expect(
      resolvePrewarmUrl('/dashboard/standards?page=2', currentHref)?.href,
    ).toBe('https://app.calibrafacil.com/dashboard/standards?page=2')
  })
})
