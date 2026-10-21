// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
  browserTracingIntegration: vi.fn(() => ({ name: 'tracing' })),
  replayIntegration: vi.fn(() => ({ name: 'replay' })),
  isDesktop: vi.fn(() => false),
  telemetry: vi.fn(() => true),
  dsn: vi.fn((): string | null => 'https://key@o0.ingest.sentry.io/1'),
}))

vi.mock('@sentry/react', () => ({
  init: mocks.init,
  captureException: mocks.captureException,
  browserTracingIntegration: mocks.browserTracingIntegration,
  replayIntegration: mocks.replayIntegration,
}))

vi.mock('@/runtime/desktop', () => ({ isDesktopRuntime: mocks.isDesktop }))

vi.mock('@/app/config/runtime', () => ({
  getSentryDsn: mocks.dsn,
  shouldEnableTelemetry: mocks.telemetry,
  shouldEnableSentryReplay: () => false,
  shouldSendSentryPii: () => false,
}))

async function loadModule() {
  vi.resetModules()
  return import('./sentry')
}

describe('route error reporting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isDesktop.mockReturnValue(false)
    mocks.telemetry.mockReturnValue(true)
    mocks.dsn.mockReturnValue('https://key@o0.ingest.sentry.io/1')
  })

  it('REQ-FE-BOUNDARY-001: captures a render crash in Sentry with its component stack', async () => {
    const { reportRouteError } = await loadModule()
    const error = new Error('render exploded')

    await reportRouteError(error, { componentStack: '\n  at Broken' })

    expect(mocks.init).toHaveBeenCalledTimes(1)
    expect(mocks.captureException).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        contexts: { react: { componentStack: '\n  at Broken' } },
      }),
    )
  })

  it('REQ-FE-BOUNDARY-002: never initializes or reports from the desktop runtime', async () => {
    mocks.isDesktop.mockReturnValue(true)
    const { reportRouteError } = await loadModule()

    await reportRouteError(new Error('desktop crash'), {})

    expect(mocks.init).not.toHaveBeenCalled()
    expect(mocks.captureException).not.toHaveBeenCalled()
  })

  it('REQ-FE-BOUNDARY-003: stays silent without a DSN or outside production telemetry', async () => {
    mocks.dsn.mockReturnValue(null)
    const withoutDsn = await loadModule()
    await withoutDsn.reportRouteError(new Error('no dsn'), {})

    mocks.dsn.mockReturnValue('https://key@o0.ingest.sentry.io/1')
    mocks.telemetry.mockReturnValue(false)
    const withoutTelemetry = await loadModule()
    await withoutTelemetry.reportRouteError(new Error('dev build'), {})

    expect(mocks.init).not.toHaveBeenCalled()
    expect(mocks.captureException).not.toHaveBeenCalled()
  })

  it('REQ-FE-BOUNDARY-004: initializes Sentry once however many errors are reported', async () => {
    const { reportRouteError, initializeSentry } = await loadModule()

    await initializeSentry()
    await reportRouteError(new Error('a'), {})
    await reportRouteError(new Error('b'), {})

    expect(mocks.init).toHaveBeenCalledTimes(1)
    expect(mocks.captureException).toHaveBeenCalledTimes(2)
  })
})
