import { describe, expect, it } from 'vitest'

import {
  defaultContractEffectiveFrom,
  defaultReceivedAt,
  receivedAtPayload,
} from './date-defaults'
import { formatFinanceDate } from '@/lib/finance-formatters'

// 23:30 in Sao Paulo on 2026-05-20 = 02:30Z on the 21st.
const EVENING = new Date('2026-05-20T23:30:00-03:00')

describe('finance date defaults (REQ-DATE-006)', () => {
  it('starts a contract on the Sao Paulo day, not the UTC day', () => {
    expect(defaultContractEffectiveFrom(EVENING)).toBe('2026-05-20')
  })

  it('defaults the receipt day to the Sao Paulo day', () => {
    expect(defaultReceivedAt(EVENING)).toBe('2026-05-20')
  })

  it('stores the typed receipt day so the ledger lists the same day', () => {
    const instant = receivedAtPayload('2026-05-20')
    expect(instant).toBe('2026-05-20T15:00:00.000Z')
    expect(formatFinanceDate(instant)).toBe('20/05/2026')
    // The bare-date parse the form used to send is UTC midnight. A day-only
    // value stored that way names its own day, so it now reads as the 20th
    // (it used to read as the 19th, the evening before in Brazil).
    expect(formatFinanceDate(new Date('2026-05-20').toISOString())).toBe(
      '20/05/2026',
    )
  })

  it('has no instant for an empty receipt day instead of throwing a RangeError', () => {
    expect(receivedAtPayload('')).toBeNull()
  })
})
