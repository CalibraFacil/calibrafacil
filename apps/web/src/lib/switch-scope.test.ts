import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { JOB_EVENT_EFFECTS } from './query-effects'
import { switchScope } from './switch-scope'

describe('switchScope (roadmap 2 F2)', () => {
  it('drops every cached result of the previous scope and applies the switch before anything refetches', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(['customers'], ['lab A customer'])
    queryClient.setQueryData(['jobs', 'CAL-1'], { id: 'CAL-1' })
    const order: string[] = []

    await switchScope(queryClient, () => {
      order.push('apply')
    })

    expect(order).toEqual(['apply'])
    expect(queryClient.getQueryData(['customers'])).toBeUndefined()
    expect(queryClient.getQueryData(['jobs', 'CAL-1'])).toBeUndefined()
  })

  it('cancels a request of the previous scope that is still in flight', async () => {
    const queryClient = new QueryClient()
    let aborted = false
    const pending = queryClient
      .fetchQuery({
        queryKey: ['jobs'],
        queryFn: ({ signal }) =>
          new Promise((resolve) => {
            signal.addEventListener('abort', () => {
              aborted = true
              resolve('aborted')
            })
          }),
      })
      .catch(() => undefined)
    const apply = vi.fn()

    await switchScope(queryClient, apply)
    await pending

    expect(aborted).toBe(true)
    expect(apply).toHaveBeenCalledOnce()
  })
})

describe('job event effects (roadmap 2 F2)', () => {
  it('every event refreshes the job views', () => {
    for (const keys of Object.values(JOB_EVENT_EFFECTS)) {
      expect(keys).toContainEqual(['jobs'])
      expect(keys).toContainEqual(['dashboard'])
    }
  })

  it('an approval also refreshes the asset, its out-of-tolerance events and the service order; an amendment the asset', () => {
    expect(JOB_EVENT_EFFECTS.approved).toEqual(
      expect.arrayContaining([
        ['assets'],
        ['asset'],
        ['customer-oot-events'],
        ['service-order'],
      ]),
    )
    expect(JOB_EVENT_EFFECTS.amended).toEqual(
      expect.arrayContaining([['assets'], ['asset']]),
    )
  })
})
