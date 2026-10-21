// @vitest-environment jsdom

import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { TanStackUnsavedChangesGate } from './unsaved-changes-gate'

// The real TanStack gate, driven through a real (memory) router, so this
// proves the adapter the execution route hands to the page actually blocks and
// releases navigation.
function buildRouter(shouldBlock: () => boolean) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> })
  const formRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/form',
    component: function FormRoute() {
      return (
        <TanStackUnsavedChangesGate shouldBlock={shouldBlock}>
          {(blocker) => (
            <div>
              <p>form:{blocker.status}</p>
              {blocker.status === 'blocked' && (
                <>
                  <button onClick={blocker.proceed}>proceed</button>
                  <button onClick={blocker.reset}>reset</button>
                </>
              )}
            </div>
          )}
        </TanStackUnsavedChangesGate>
      )
    },
  })
  const otherRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/other',
    component: () => <p>other page</p>,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([formRoute, otherRoute]),
    history: createMemoryHistory({ initialEntries: ['/form'] }),
  })
  return router
}

afterEach(() => {
  cleanup()
})

describe('TanStackUnsavedChangesGate', () => {
  it('REQ-P07-2: blocks in-app navigation while shouldBlock() is true and stays on the page', async () => {
    const router = buildRouter(() => true)
    render(<RouterProvider router={router} />)
    await screen.findByText('form:idle')

    await act(async () => {
      router.history.push('/other')
    })

    await screen.findByText('form:blocked')
    expect(router.state.location.pathname).toBe('/form')
  })

  it('REQ-P07-2: proceed completes the blocked navigation, reset cancels it', async () => {
    const router = buildRouter(() => true)
    render(<RouterProvider router={router} />)
    await screen.findByText('form:idle')

    await act(async () => {
      router.history.push('/other')
    })
    await act(async () => {
      screen.getByText('reset').click()
    })
    await screen.findByText('form:idle')
    expect(router.state.location.pathname).toBe('/form')

    await act(async () => {
      router.history.push('/other')
    })
    await act(async () => {
      screen.getByText('proceed').click()
    })
    await screen.findByText('other page')
    expect(router.state.location.pathname).toBe('/other')
  })

  it('REQ-P07-2: does not block when shouldBlock() is false', async () => {
    const router = buildRouter(() => false)
    render(<RouterProvider router={router} />)
    await screen.findByText('form:idle')

    await act(async () => {
      router.history.push('/other')
    })

    await screen.findByText('other page')
    expect(router.state.location.pathname).toBe('/other')
  })

  it('REQ-P07-2: shouldBlock() is read when navigation happens, not when it was rendered', async () => {
    let dirty = true
    const router = buildRouter(() => dirty)
    render(<RouterProvider router={router} />)
    await screen.findByText('form:idle')

    // e.g. a successful submit that navigates in the same tick it clears dirt.
    dirty = false
    await act(async () => {
      router.history.push('/other')
    })

    await screen.findByText('other page')
  })
})
