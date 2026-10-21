// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'

import { RoutePendingFallback, routeBoundaryOptions } from './route-boundaries'

const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
  isDesktop: vi.fn(() => false),
}))

vi.mock('@sentry/react', () => ({
  init: mocks.init,
  captureException: mocks.captureException,
  browserTracingIntegration: () => ({ name: 'tracing' }),
  replayIntegration: () => ({ name: 'replay' }),
}))

vi.mock('@/runtime/desktop', () => ({ isDesktopRuntime: mocks.isDesktop }))

vi.mock('@/app/config/runtime', () => ({
  getSentryDsn: () => 'https://key@o0.ingest.sentry.io/1',
  shouldEnableTelemetry: () => true,
  shouldEnableSentryReplay: () => false,
  shouldSendSentryPii: () => false,
}))

let shouldCrash = true

function Broken() {
  if (shouldCrash) throw new Error('boom na renderização')
  return <p>conteúdo recuperado</p>
}

function renderApp(
  initialPath: string,
  options: { loaderFails?: boolean } = {},
) {
  const rootRoute = createRootRoute({ component: Outlet })
  const brokenRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/quebrada',
    component: Broken,
  })
  const loaderRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/carga',
    loader: () => {
      if (options.loaderFails) throw new Error('falha no loader')
      return null
    },
    component: () => <p>carregada</p>,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([brokenRoute, loaderRoute]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
    ...routeBoundaryOptions,
  })
  return render(<RouterProvider router={router} />)
}

describe('router boundaries (web)', () => {
  beforeEach(() => {
    shouldCrash = true
    vi.clearAllMocks()
    mocks.isDesktop.mockReturnValue(false)
    // React logs caught render errors; keep the test output readable.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('REQ-FE-BOUNDARY-010: a route render crash shows pt-BR copy and is reported to Sentry', async () => {
    renderApp('/quebrada')

    expect(
      await screen.findByText('Algo deu errado ao carregar esta página'),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Tentar novamente' }),
    ).toBeTruthy()

    await waitFor(() => expect(mocks.captureException).toHaveBeenCalledTimes(1))
    const [reported] = mocks.captureException.mock.calls[0] ?? []
    expect(reported).toBeInstanceOf(Error)
    expect(reported.message).toBe('boom na renderização')
  })

  it('REQ-FE-BOUNDARY-011: a loader failure also reaches the boundary and Sentry', async () => {
    renderApp('/carga', { loaderFails: true })

    expect(
      await screen.findByText('Algo deu errado ao carregar esta página'),
    ).toBeTruthy()
    await waitFor(() => expect(mocks.captureException).toHaveBeenCalled())
  })

  it('REQ-FE-BOUNDARY-012: the retry action resets the boundary and re-renders the route', async () => {
    renderApp('/quebrada')
    const retry = await screen.findByRole('button', {
      name: 'Tentar novamente',
    })

    shouldCrash = false
    fireEvent.click(retry)

    expect(await screen.findByText('conteúdo recuperado')).toBeTruthy()
  })

  it('REQ-FE-BOUNDARY-013: an unknown URL renders the pt-BR not-found page with a way home', async () => {
    renderApp('/nao-existe')

    expect(await screen.findByText('Página não encontrada')).toBeTruthy()
    const home = screen.getByRole('button', { name: 'Ir para o início' })
    expect(home.getAttribute('href')).toBe('/dashboard')
    expect(mocks.captureException).not.toHaveBeenCalled()
  })

  it('REQ-FE-BOUNDARY-014: the pending fallback announces loading in pt-BR', () => {
    render(<RoutePendingFallback />)

    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.getByText('Carregando…')).toBeTruthy()
  })

  it('REQ-FE-BOUNDARY-015: the desktop runtime shows the boundary but never reports to Sentry', async () => {
    mocks.isDesktop.mockReturnValue(true)
    renderApp('/quebrada')

    expect(
      await screen.findByText('Algo deu errado ao carregar esta página'),
    ).toBeTruthy()
    // Give the (skipped) async report a chance to run.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(mocks.init).not.toHaveBeenCalled()
    expect(mocks.captureException).not.toHaveBeenCalled()
  })
})
