import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
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

describe('switchScope when the switch is refused', () => {
  it('keeps the cache', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(['customers'], ['lab A customer'])

    await switchScope(
      queryClient,
      () => ({ error: 'refused' }),
      (result) => !result.error,
    )

    expect(queryClient.getQueryData(['customers'])).toEqual(['lab A customer'])
  })
})

describe('the one tenant-scope mechanism', () => {
  it('is the only place that changes the active organization', () => {
    const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..')
    const offenders: string[] = []
    const visit = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry)
        if (statSync(path).isDirectory()) {
          visit(path)
        } else if (
          /\.(ts|tsx)$/.test(entry) &&
          !/\.(test|spec)\./.test(entry) &&
          readFileSync(path, 'utf8').includes('organization.setActive(')
        ) {
          offenders.push(relative(srcDir, path))
        }
      }
    }
    visit(srcDir)

    expect(offenders).toEqual(['lib/switch-scope.ts'])
  })
})
