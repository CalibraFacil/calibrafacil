import { describe, expect, it } from 'vitest'
import { approvalBlockedMessage, serverAllows } from './allowed-actions'

const reviewForSubmitter = {
  approve: { allowed: false as const, reason: 'self_approval' as const },
  reject: { allowed: true as const },
  cancel: { allowed: true as const },
  assign: { allowed: true as const },
  amend: { allowed: false as const, reason: 'status' as const },
  withdraw: { allowed: false as const, reason: 'status' as const },
  retry_render: { allowed: false as const, reason: 'status' as const },
}

describe('allowed actions from the server (roadmap 2 F1)', () => {
  it("the server's verdict wins over the status rule", () => {
    expect(serverAllows(reviewForSubmitter, 'approve', true)).toBe(false)
    expect(serverAllows(reviewForSubmitter, 'reject', false)).toBe(true)
  })

  it('without a verdict (desktop) the status rule applies', () => {
    expect(serverAllows(undefined, 'approve', true)).toBe(true)
    expect(serverAllows(undefined, 'approve', false)).toBe(false)
  })

  it('explains a separation-of-duties refusal, and says nothing otherwise', () => {
    expect(approvalBlockedMessage(reviewForSubmitter)).toContain(
      'outro aprovador',
    )
    expect(approvalBlockedMessage(undefined)).toBeNull()
    expect(
      approvalBlockedMessage({
        ...reviewForSubmitter,
        approve: { allowed: true },
      }),
    ).toBeNull()
  })
})
