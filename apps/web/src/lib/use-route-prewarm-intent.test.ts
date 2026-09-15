import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createRoutePrewarmIntent,
  resolvePrewarmUrl,
} from './use-route-prewarm-intent'

describe('resolvePrewarmUrl', () => {
  const currentHref = 'https://app.calibrafacil.com/dashboard'

  it('does not prewarm routes in the desktop runtime', () => {
    expect(
      resolvePrewarmUrl('/dashboard/standards', currentHref, {
        isDesktop: true,
      }),
    ).toBeNull()
  })

  it('does not prewarm external links', () => {
    expect(
      resolvePrewarmUrl('https://calibrafacil.com/docs', currentHref),
    ).toBeNull()
  })

  it('resolves internal web routes for prewarm', () => {
    expect(
      resolvePrewarmUrl('/dashboard/standards?page=2', currentHref)?.href,
    ).toBe('https://app.calibrafacil.com/dashboard/standards?page=2')
  })
})

describe('createRoutePrewarmIntent', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounces repeated intent into a single prewarm', () => {
    const prewarm = vi.fn()
    const controller = createRoutePrewarmIntent({ debounceMs: 50 })

    controller.schedule(prewarm)
    controller.schedule(prewarm)
    vi.advanceTimersByTime(50)

    expect(prewarm).toHaveBeenCalledTimes(1)
  })

  it('cancels a pending prewarm', () => {
    const prewarm = vi.fn()
    const controller = createRoutePrewarmIntent({ debounceMs: 50 })

    controller.schedule(prewarm)
    controller.cancel()
    vi.advanceTimersByTime(50)

    expect(prewarm).not.toHaveBeenCalled()
  })

  it('runs the callback supplied by the latest intent', () => {
    const first = vi.fn()
    const second = vi.fn()
    const controller = createRoutePrewarmIntent({ debounceMs: 50 })

    controller.schedule(first)
    vi.advanceTimersByTime(50)
    controller.schedule(second)
    vi.advanceTimersByTime(50)

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('swallows prewarm failures so navigation owns visible errors', async () => {
    const controller = createRoutePrewarmIntent({ debounceMs: 0 })
    const prewarm = vi.fn(() => Promise.reject(new Error('offline')))

    controller.schedule(prewarm)
    // An unswallowed rejection here would surface as an unhandled rejection
    // and fail the run.
    await vi.advanceTimersByTimeAsync(0)

    expect(prewarm).toHaveBeenCalledTimes(1)
  })
})
