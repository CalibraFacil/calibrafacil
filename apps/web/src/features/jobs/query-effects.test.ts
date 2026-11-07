import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { assetKeys } from '@/features/assets/keys'
import { customerKeys } from '@/features/customers/keys'
import { dashboardKeys } from '@/features/dashboard/keys'
import { financeKeys } from '@/features/finance/keys'
import { notificationKeys } from '@/features/notifications/keys'
import { serviceOrderKeys } from '@/features/service-orders/keys'
import { visitKeys } from '@/features/visits/keys'
import { jobKeys } from './keys'
import { JOB_EVENT_EFFECTS } from './query-effects'

describe('job event effects (roadmap 2 F2)', () => {
  it('every event refreshes the job views', () => {
    for (const keys of Object.values(JOB_EVENT_EFFECTS)) {
      expect(keys).toContainEqual(jobKeys.all)
      expect(keys).toContainEqual(dashboardKeys.all)
    }
  })

  it('an approval also refreshes the asset, its out-of-tolerance events and the service order; an amendment the asset', () => {
    expect(JOB_EVENT_EFFECTS.approved).toEqual(
      expect.arrayContaining([
        ...assetKeys.prefixes,
        customerKeys.ootEventsAll,
        serviceOrderKeys.details,
      ]),
    )
    expect(JOB_EVENT_EFFECTS.amended).toEqual(
      expect.arrayContaining([...assetKeys.prefixes]),
    )
  })

  it('marks the cached queries of the other features stale (the prefixes really match their keys)', async () => {
    const queryClient = new QueryClient()
    const cached = {
      job: jobKeys.detail('9'),
      jobList: jobKeys.list({
        organizationId: 'org-1',
        page: 1,
        search: '',
        statusFilter: '',
      }),
      stats: dashboardKeys.stats('org-1'),
      asset: assetKeys.detail('4'),
      assetAudit: assetKeys.auditLog('4'),
      assetList: assetKeys.listScope('org-1'),
      oot: customerKeys.ootEvents(3),
      serviceOrder: serviceOrderKeys.detail('so-1'),
      serviceOrderFinancial: serviceOrderKeys.financialStatus('so-1'),
      notifications: notificationKeys.unreadCount('org-1'),
      finance: financeKeys.overview,
      visit: visitKeys.detail('v-1'),
    }
    for (const key of Object.values(cached)) {
      queryClient.setQueryData(key, 'data')
    }

    await Promise.all(
      JOB_EVENT_EFFECTS.approved.map((queryKey) =>
        queryClient.invalidateQueries({ queryKey }),
      ),
    )

    const stale = (key: readonly unknown[]) =>
      queryClient.getQueryState(key)?.isInvalidated
    for (const [name, key] of Object.entries(cached)) {
      // An approval does not touch visits; every other cached entry is stale.
      expect([name, stale(key) ?? false]).toEqual([name, name !== 'visit'])
    }
  })
})
