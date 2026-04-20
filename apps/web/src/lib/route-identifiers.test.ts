import { describe, expect, it } from 'vitest'

import { apiRouteParam } from './route-identifiers'

describe('apiRouteParam', () => {
  it('encodes slashes in display identifiers for API path params', () => {
    expect(apiRouteParam('R-0001/2026')).toBe('R-0001%2F2026')
  })

  it('does not double-encode already encoded identifiers', () => {
    expect(apiRouteParam('R-0001%2F2026')).toBe('R-0001%2F2026')
  })
})
