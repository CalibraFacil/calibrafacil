import { describe, expect, it } from 'vitest'

import {
  contaAzulOAuthErrorFromSearch,
  validateIntegrationsSearch,
} from './search'

describe('validateIntegrationsSearch', () => {
  it('keeps the callback failure and its reason', () => {
    const search = validateIntegrationsSearch({
      contaAzulOAuth: 'error',
      reason: 'exchange_failed',
    })

    expect(search).toEqual({
      contaAzulOAuth: 'error',
      reason: 'exchange_failed',
    })
    expect(contaAzulOAuthErrorFromSearch(search)).toEqual({
      reason: 'exchange_failed',
    })
  })

  it('ignores anything that is not a failure and passes other params through', () => {
    const search = validateIntegrationsSearch({
      contaAzulOAuth: 'connected',
      reason: 'x',
      onboarding: 'erp',
    })

    expect(search).toEqual({ onboarding: 'erp' })
    expect(contaAzulOAuthErrorFromSearch(search)).toBeNull()
  })

  it('reports a failure without a reason', () => {
    expect(
      contaAzulOAuthErrorFromSearch(
        validateIntegrationsSearch({ contaAzulOAuth: 'error', reason: 1 }),
      ),
    ).toEqual({ reason: null })
  })
})
