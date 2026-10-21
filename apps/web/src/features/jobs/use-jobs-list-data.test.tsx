// @vitest-environment jsdom

import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const listMock = vi.hoisted(() => vi.fn())

vi.mock('@/utils/api', () => ({
  calibraApi: {
    jobs: { list: listMock },
  },
}))

import { useJobsListData } from './use-jobs-list-data'

function pageOf(page: number, ids: Array<string>) {
  return {
    data: ids.map((id) => ({ id })),
    pagination: { page, limit: 20, total: 40, totalPages: 2 },
  }
}

function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
  }
}

type HookProps = {
  organizationId: string
  page: number
  search?: string
}

describe('useJobsListData', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    listMock.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  function renderJobs(initial: HookProps) {
    return renderHook(
      ({ organizationId, page, search = '' }: HookProps) =>
        useJobsListData({
          activeOrganizationId: organizationId,
          enabled: true,
          page,
          search,
          statusFilter: '',
        }),
      { initialProps: initial, wrapper: wrapperFor(queryClient) },
    )
  }

  it('REQ-FE-LIST-001: keeps the previous page rows (no skeleton) while the next page loads', async () => {
    const nextPage = deferred<ReturnType<typeof pageOf>>()
    listMock.mockImplementation(({ page }: { page: number }) =>
      page === 1 ? Promise.resolve(pageOf(1, ['a', 'b'])) : nextPage.promise,
    )

    const { result, rerender } = renderJobs({
      organizationId: 'org-1',
      page: 1,
    })
    await waitFor(() => expect(result.current.data?.data).toHaveLength(2))

    rerender({ organizationId: 'org-1', page: 2 })

    // Page 2 is still in flight: page 1 rows stay, nothing flashes to loading.
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2))
    expect(result.current.isLoading).toBe(false)
    expect(result.current.isPlaceholderData).toBe(true)
    expect(result.current.data?.data.map((job) => job.id)).toEqual(['a', 'b'])

    await act(async () => {
      nextPage.resolve(pageOf(2, ['c']))
      await nextPage.promise
    })
    await waitFor(() =>
      expect(result.current.data?.data.map((job) => job.id)).toEqual(['c']),
    )
    expect(result.current.isPlaceholderData).toBe(false)
  })

  it('REQ-FE-LIST-002: keeps rows while a new search term loads', async () => {
    const searched = deferred<ReturnType<typeof pageOf>>()
    listMock.mockImplementation(({ query }: { query?: string }) =>
      query ? searched.promise : Promise.resolve(pageOf(1, ['a', 'b'])),
    )

    const { result, rerender } = renderJobs({
      organizationId: 'org-1',
      page: 1,
    })
    await waitFor(() => expect(result.current.data?.data).toHaveLength(2))

    rerender({ organizationId: 'org-1', page: 1, search: 'balança' })

    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2))
    expect(result.current.isLoading).toBe(false)
    expect(result.current.data?.data).toHaveLength(2)
  })

  it("REQ-FE-LIST-003: never shows another organization's rows while a switched organization loads", async () => {
    const otherOrg = deferred<ReturnType<typeof pageOf>>()
    let call = 0
    listMock.mockImplementation(() => {
      call += 1
      return call === 1
        ? Promise.resolve(pageOf(1, ['org-1-job']))
        : otherOrg.promise
    })

    const { result, rerender } = renderJobs({
      organizationId: 'org-1',
      page: 1,
    })
    await waitFor(() => expect(result.current.data?.data).toHaveLength(1))

    rerender({ organizationId: 'org-2', page: 1 })

    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2))
    expect(result.current.data).toBeUndefined()
    expect(result.current.isLoading).toBe(true)
  })
})
