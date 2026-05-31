import { describe, expect, it } from 'vitest'

import {
  invitationQueryOptions,
  publicCheckoutSnapshotQueryOptions,
  publicCheckoutStatusQueryOptions,
} from './queries'

describe('public feature queries', () => {
  it('uses stable invitation keys', () => {
    expect(invitationQueryOptions('inv-1').queryKey).toEqual([
      'accept-invitation',
      'inv-1',
    ])
  })

  it('uses stable public checkout keys', () => {
    expect(publicCheckoutSnapshotQueryOptions('token-1').queryKey).toEqual([
      'public-commercial-checkout',
      'token-1',
      'snapshot',
    ])
    expect(publicCheckoutStatusQueryOptions('token-1').queryKey).toEqual([
      'public-commercial-checkout',
      'token-1',
      'status',
    ])
  })
})
