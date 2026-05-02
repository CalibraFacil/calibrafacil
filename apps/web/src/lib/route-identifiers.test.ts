import { describe, expect, it } from 'vitest'

import { apiRouteParam } from './route-identifiers'

describe('apiRouteParam', () => {
  it('preserves slashes through Hono client path interpolation', () => {
    expect(apiRouteParam('R-0001/2026')).toBe('R-0001%252F2026')
  })

  it('normalizes already encoded identifiers before API path encoding', () => {
    expect(apiRouteParam('R-0001%2F2026')).toBe('R-0001%252F2026')
  })

  it('leaves numeric identifiers unchanged', () => {
    expect(apiRouteParam(123)).toBe('123')
  })
})
