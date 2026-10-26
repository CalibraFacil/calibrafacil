import { describe, expect, it } from 'vitest'

import { isIndependenceWaiverOffered } from './capa-verification'

const refusal = (waiver: boolean) => ({
  message: 'Separação de responsabilidades',
  status: 403,
  payload: {
    error: 'Separação de responsabilidades',
    code: 'self_approval_blocked',
    details: { independence_waiver_available: waiver },
  },
})

describe('isIndependenceWaiverOffered', () => {
  it('is true only for a self_approval_blocked refusal that offers the waiver', () => {
    expect(isIndependenceWaiverOffered(refusal(true))).toBe(true)
    expect(isIndependenceWaiverOffered(refusal(false))).toBe(false)
  })

  it('is false for other errors and for shapes it does not know', () => {
    expect(isIndependenceWaiverOffered(new Error('boom'))).toBe(false)
    expect(isIndependenceWaiverOffered(null)).toBe(false)
    expect(isIndependenceWaiverOffered('x')).toBe(false)
    expect(
      isIndependenceWaiverOffered({
        payload: {
          code: 'not_found',
          details: { independence_waiver_available: true },
        },
      }),
    ).toBe(false)
  })
})
