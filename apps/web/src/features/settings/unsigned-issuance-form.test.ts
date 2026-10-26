import { describe, expect, it } from 'vitest'

import {
  buildUnsignedIssuancePayload,
  UNSIGNED_ISSUANCE_REASON_MIN_LENGTH,
} from './unsigned-issuance-form'

describe('buildUnsignedIssuancePayload (Q51)', () => {
  it('trims and accepts a justification of the minimum length', () => {
    const reason = 'a'.repeat(UNSIGNED_ISSUANCE_REASON_MIN_LENGTH)
    expect(buildUnsignedIssuancePayload(`  ${reason}  `)).toEqual({
      ok: true,
      payload: { enabled: true, reason },
    })
  })

  it('refuses an empty or too short justification with a pt-BR message', () => {
    for (const reason of ['', '   ', 'curto']) {
      const result = buildUnsignedIssuancePayload(reason)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toContain('justificativa')
    }
  })

  it('counts the length after trimming', () => {
    const padded = ` ${'a'.repeat(UNSIGNED_ISSUANCE_REASON_MIN_LENGTH - 1)} `
    expect(buildUnsignedIssuancePayload(padded).ok).toBe(false)
  })
})
