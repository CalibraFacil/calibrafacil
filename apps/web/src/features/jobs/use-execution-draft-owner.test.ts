import { describe, expect, it } from 'vitest'

import { resolveExecutionDraftOwner } from './use-execution-draft-owner'

describe('resolveExecutionDraftOwner', () => {
  it('REQ-P07-3: returns the org and user the draft belongs to', () => {
    expect(resolveExecutionDraftOwner('org-1', 'user-1')).toEqual({
      organizationId: 'org-1',
      userId: 'user-1',
    })
  })

  it('REQ-P07-3: refuses to scope a draft while the org or the user is unknown', () => {
    expect(resolveExecutionDraftOwner(null, 'user-1')).toBeNull()
    expect(resolveExecutionDraftOwner('org-1', undefined)).toBeNull()
    expect(resolveExecutionDraftOwner('', 'user-1')).toBeNull()
    expect(resolveExecutionDraftOwner('org-1', '')).toBeNull()
  })
})
