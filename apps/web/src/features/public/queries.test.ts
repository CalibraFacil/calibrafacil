import { describe, expect, it } from 'vitest'

import { invitationQueryOptions } from './queries'

describe('public feature queries', () => {
  it('uses stable invitation keys', () => {
    expect(invitationQueryOptions('inv-1').queryKey).toEqual([
      'accept-invitation',
      'inv-1',
    ])
  })
})
