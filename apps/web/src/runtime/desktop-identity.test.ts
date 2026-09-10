import { describe, expect, it, vi } from 'vitest'

import { verificationAuthorizes, verifyCloudIdentity } from './desktop-identity'

describe('verifyCloudIdentity', () => {
  it('verifies a session the cloud affirmed', async () => {
    await expect(
      verifyCloudIdentity(async () => ({
        data: {
          user: { id: 'user-ana' },
          session: { activeOrganizationId: 'org-1' },
        },
      })),
    ).resolves.toEqual({
      userId: 'user-ana',
      activeOrganizationId: 'org-1',
      verified: true,
    })
  })

  it('is unverified when the request could not be made', async () => {
    // Offline, DNS failure, proxy down — all the same answer. Failing closed
    // costs a sign-in; failing open opens another account's records.
    await expect(
      verifyCloudIdentity(async () => {
        throw new Error('Failed to fetch')
      }),
    ).resolves.toMatchObject({ userId: null, verified: false })
  })

  it('is unverified when the server returned an error', async () => {
    await expect(
      verifyCloudIdentity(async () => ({ error: { status: 401 } })),
    ).resolves.toMatchObject({ userId: null, verified: false })
  })

  it('does not read around an error that arrives with data', async () => {
    // A response carrying both is not an affirmation.
    await expect(
      verifyCloudIdentity(async () => ({
        data: { user: { id: 'user-ana' } },
        error: { status: 403 },
      })),
    ).resolves.toMatchObject({ userId: null, verified: false })
  })

  it('is unverified for an empty session', async () => {
    for (const result of [
      { data: null },
      { data: { user: null } },
      { data: { user: { id: null } } },
      {},
    ]) {
      await expect(
        verifyCloudIdentity(async () => result),
      ).resolves.toMatchObject({ userId: null, verified: false })
    }
  })

  it('asks for an uncached read exactly once', async () => {
    // Retrying would risk a cached answer standing in for a fresh one.
    const read = vi.fn(async () => ({
      data: {
        user: { id: 'user-ana' },
        session: { activeOrganizationId: 'org-1' },
      },
    }))

    await verifyCloudIdentity(read)

    expect(read).toHaveBeenCalledOnce()
  })
})

describe('verificationAuthorizes', () => {
  const requested = { userId: 'user-ana', organizationId: 'org-1' }

  it('authorizes the account and organization the cloud confirmed', () => {
    expect(
      verificationAuthorizes(
        { userId: 'user-ana', activeOrganizationId: 'org-1', verified: true },
        requested,
      ),
    ).toBe(true)
  })

  it('refuses when the cloud verified a different account', () => {
    // The requested identity comes from renderer state that can lag an account
    // change; a session confirming Bruno must not open Ana's database.
    expect(
      verificationAuthorizes(
        { userId: 'user-bruno', activeOrganizationId: 'org-1', verified: true },
        requested,
      ),
    ).toBe(false)
  })

  it('refuses an organization the session is not acting in', () => {
    // The only membership proof available here: the server's own active
    // organization, not one the renderer asked for.
    expect(
      verificationAuthorizes(
        { userId: 'user-ana', activeOrganizationId: 'org-2', verified: true },
        requested,
      ),
    ).toBe(false)
  })

  it('refuses when the session carries no organization at all', () => {
    expect(
      verificationAuthorizes(
        { userId: 'user-ana', activeOrganizationId: null, verified: true },
        requested,
      ),
    ).toBe(false)
  })

  it('refuses an unverified identity even when it matches', () => {
    expect(
      verificationAuthorizes(
        { userId: 'user-ana', activeOrganizationId: 'org-1', verified: false },
        requested,
      ),
    ).toBe(false)
  })
})
