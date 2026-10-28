import { describe, expect, it, vi } from 'vitest'
import {
  createSessionExpiryHandler,
  isUnauthenticatedError,
  shouldRetryQuery,
} from './session-expiry'

function deps(location = '/dashboard/jobs/7/execute?tab=readings') {
  const notify = vi.fn()
  const goToSignIn = vi.fn()
  return {
    notify,
    goToSignIn,
    handler: createSessionExpiryHandler({
      currentLocation: () => location,
      notify,
      goToSignIn,
    }),
  }
}

describe('global session expiry (roadmap 2 F4)', () => {
  it('REQ-F4-2: a 401 is never retried; other failures are, up to three times', () => {
    expect(shouldRetryQuery(0, { status: 401 })).toBe(false)
    expect(shouldRetryQuery(0, { status: 503 })).toBe(true)
    expect(shouldRetryQuery(3, new Error('x'))).toBe(false)
    expect(isUnauthenticatedError({ status: 403 })).toBe(false)
  })

  it('REQ-F4-2: the first 401 shows one notice; its action goes to sign-in and back to where the user was', () => {
    const { handler, notify, goToSignIn } = deps()

    handler({ status: 401 })
    handler({ status: 401 })
    handler(new Error('network'))

    expect(notify).toHaveBeenCalledTimes(1)
    notify.mock.calls[0]?.[0].onSignIn()
    expect(goToSignIn).toHaveBeenCalledWith(
      '/dashboard/jobs/7/execute?tab=readings',
    )
  })

  it('REQ-F4-2: once dismissed, a later 401 shows the notice again; on the sign-in page it returns to the dashboard', () => {
    const { handler, notify, goToSignIn } = deps('/sign-in?redirect=%2Fx')

    handler({ status: 401 })
    notify.mock.calls[0]?.[0].onDismiss()
    handler({ status: 401 })
    expect(notify).toHaveBeenCalledTimes(2)

    notify.mock.calls[1]?.[0].onSignIn()
    expect(goToSignIn).toHaveBeenCalledWith('/dashboard')
  })
})
