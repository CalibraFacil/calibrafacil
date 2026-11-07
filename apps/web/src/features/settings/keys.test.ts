import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import { sessionKeys } from '@/lib/query-keys'
import { environmentalLimitKeys, integrationKeys } from './keys'

describe('settings query keys', () => {
  it('saving environmental limits also marks the job-side effective limits stale', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(environmentalLimitKeys.unit('u1'), 'list')
    queryClient.setQueryData(
      environmentalLimitKeys.effective(7, 'u1'),
      'effective',
    )

    await queryClient.invalidateQueries({
      queryKey: environmentalLimitKeys.all,
    })

    expect(
      queryClient.getQueryState(environmentalLimitKeys.unit('u1'))
        ?.isInvalidated,
    ).toBe(true)
    expect(
      queryClient.getQueryState(environmentalLimitKeys.effective(7, 'u1'))
        ?.isInvalidated,
    ).toBe(true)
  })

  it('tells Conta Azul catalogs from the rest of the integrations cache', () => {
    expect(
      integrationKeys.isCatalog(integrationKeys.catalog('i1', 'accounts')),
    ).toBe(true)
    expect(integrationKeys.isCatalog(integrationKeys.catalogsOf('i1'))).toBe(
      true,
    )
    expect(integrationKeys.isCatalog(integrationKeys.all)).toBe(false)
    expect(integrationKeys.isCatalog(integrationKeys.contaAzulApp)).toBe(false)
    expect(
      integrationKeys.isCatalog(integrationKeys.runItems('i1', 'r1')),
    ).toBe(false)
  })

  it('keeps the governance keys under the prefixes the invalidations use', () => {
    expect(sessionKeys.dashboardUnits('o1', true, 'cloud').slice(0, 2)).toEqual(
      sessionKeys.dashboardUnitsOf('o1'),
    )
  })
})
