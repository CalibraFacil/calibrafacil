import { describe, expect, it } from 'vitest'

import {
  customerSuccessProfileQueryOptions,
  customerSuccessRequestsQueryOptions,
} from './queries'

describe('customer success feature queries', () => {
  it('uses stable profile and request keys', () => {
    expect(customerSuccessProfileQueryOptions().queryKey).toEqual([
      'customer-success',
      'profile',
    ])
    expect(customerSuccessRequestsQueryOptions().queryKey).toEqual([
      'customer-success',
      'requests',
    ])
  })
})
