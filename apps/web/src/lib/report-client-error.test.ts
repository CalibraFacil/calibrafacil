import { afterEach, describe, expect, it, vi } from 'vitest'

import { reportClientError } from './report-client-error'

describe('reportClientError (web)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('REQ-FE-BOUNDARY-040: writes one structured console.error line with the crash details', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = new TypeError('boom')

    reportClientError(error, {
      route: '/ordens',
      componentStack: '\n  at Broken',
    })

    expect(spy).toHaveBeenCalledTimes(1)
    const [line] = spy.mock.calls[0] ?? []
    expect(typeof line).toBe('string')
    const entry = JSON.parse(String(line))
    expect(entry).toMatchObject({
      message: 'boom',
      name: 'TypeError',
      stack: error.stack,
      route: '/ordens',
      componentStack: '\n  at Broken',
      app: 'web',
    })
    expect(Number.isNaN(Date.parse(entry.timestamp))).toBe(false)
  })

  it('REQ-FE-BOUNDARY-041: reports non-Error throwables and a missing component stack', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    reportClientError('texto solto', { route: '/' })

    const entry = JSON.parse(String(spy.mock.calls[0]?.[0]))
    expect(entry.message).toBe('texto solto')
    expect(entry.componentStack).toBeNull()
  })

  it('REQ-FE-BOUNDARY-042: never throws, even when the console fails', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {
      throw new Error('console broken')
    })

    expect(() =>
      reportClientError(new Error('x'), { route: '/' }),
    ).not.toThrow()
  })
})
