// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DASHBOARD_ORG_KEY } from '@calibra-facil/shared/client-storage-keys'

const setActive = vi.hoisted(() => vi.fn())

vi.mock('@calibra-facil/auth/client', () => ({
  organization: { setActive },
}))

import { watchOtherTabScope } from './switch-scope'

/** What the browser does in a tab that did NOT write the key. */
function otherTabWrites(key: string, newValue: string | null) {
  window.dispatchEvent(new StorageEvent('storage', { key, newValue }))
}

async function settle() {
  await vi.waitFor(() => expect(setActive).toHaveBeenCalled())
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('watchOtherTabScope', () => {
  let queryClient: QueryClient
  let stop: () => void

  beforeEach(() => {
    setActive.mockReset()
    setActive.mockResolvedValue({ data: {}, error: null })
    queryClient = new QueryClient()
    queryClient.setQueryData(['customers'], ['lab A customer'])
    stop = watchOtherTabScope(queryClient)
  })

  afterEach(() => stop())

  it('resets the cache and follows the session when another tab switches organization', async () => {
    otherTabWrites(DASHBOARD_ORG_KEY, 'org-b')
    await settle()

    expect(setActive).toHaveBeenCalledWith({ organizationId: 'org-b' })
    expect(queryClient.getQueryData(['customers'])).toBeUndefined()
  })

  it('resets the cache when another tab switches unit inside an organization', async () => {
    otherTabWrites('dashboard-active-unit:org-a', 'unit-2')
    await vi.waitFor(() =>
      expect(queryClient.getQueryData(['customers'])).toBeUndefined(),
    )

    expect(setActive).not.toHaveBeenCalled()
  })

  it('ignores unrelated keys and removals', async () => {
    otherTabWrites('theme', 'dark')
    otherTabWrites(DASHBOARD_ORG_KEY, null)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(setActive).not.toHaveBeenCalled()
    expect(queryClient.getQueryData(['customers'])).toEqual(['lab A customer'])
  })

  it('stops listening once unsubscribed', async () => {
    stop()
    otherTabWrites(DASHBOARD_ORG_KEY, 'org-b')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(setActive).not.toHaveBeenCalled()
    expect(queryClient.getQueryData(['customers'])).toEqual(['lab A customer'])
  })
})
