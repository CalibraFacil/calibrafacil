import { useBlocker } from '@tanstack/react-router'
import type { ReactNode } from 'react'

/**
 * Router-agnostic contract for "ask before leaving this page".
 *
 * Feature modules stay free of router coupling (see
 * docs/architecture/web-frontend-architecture.md): the route adapter passes
 * {@link UnsavedChangesGate} in as a prop, and the feature renders its own
 * confirm dialog from the blocker state it receives. The gate is a component
 * (not a hook passed around as a value) so it composes with the React rules;
 * tests hand the feature a plain fake gate.
 */
export type UnsavedChangesBlocker =
  | { status: 'idle' }
  | { status: 'blocked'; proceed: () => void; reset: () => void }

export type UnsavedChangesGateProps = {
  /**
   * Evaluated when a navigation is attempted, not when the component rendered,
   * so a handler can clear the dirt and navigate in the same tick.
   */
  shouldBlock: () => boolean
  children: (blocker: UnsavedChangesBlocker) => ReactNode
}

export type UnsavedChangesGate = (props: UnsavedChangesGateProps) => ReactNode

/** Used when no route adapter supplies a gate (tests, embedded renders). */
export function NoUnsavedChangesGate({ children }: UnsavedChangesGateProps) {
  return children({ status: 'idle' })
}

/**
 * TanStack Router implementation of {@link UnsavedChangesGate}.
 *
 * `enableBeforeUnload` stays off on purpose: the browser `beforeunload` prompt
 * is owned by the execution page, which arms it only while dirty and flushes
 * the local draft in the same handler.
 */
export function TanStackUnsavedChangesGate({
  shouldBlock,
  children,
}: UnsavedChangesGateProps) {
  const resolver = useBlocker({
    shouldBlockFn: () => shouldBlock(),
    enableBeforeUnload: false,
    withResolver: true,
  })

  return children(
    resolver.status === 'blocked'
      ? {
          status: 'blocked',
          proceed: resolver.proceed,
          reset: resolver.reset,
        }
      : { status: 'idle' },
  )
}
