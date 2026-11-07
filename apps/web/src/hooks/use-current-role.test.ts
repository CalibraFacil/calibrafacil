import { describe, expect, it } from 'vitest'

import { currentMemberRole } from './use-current-role'

describe('currentMemberRole', () => {
  const organization = {
    members: [
      { userId: 'owner-1', role: 'owner' },
      { userId: 'tech-1', role: 'technician' },
    ],
  }

  it("reads the signed-in user's own membership, not the first member's", () => {
    expect(currentMemberRole(organization, 'tech-1')).toBe('technician')
  })

  it('falls back to member when the user is not listed or unknown', () => {
    expect(currentMemberRole(organization, 'someone-else')).toBe('member')
    expect(currentMemberRole(organization, undefined)).toBe('member')
    expect(
      currentMemberRole({ members: [{ userId: 'x', role: 'weird' }] }, 'x'),
    ).toBe('member')
  })
})
