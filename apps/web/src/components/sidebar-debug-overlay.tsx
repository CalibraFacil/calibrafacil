import { useRef } from 'react'
import { useRouter } from '@tanstack/react-router'

import {
  describeEventTarget,
  getSidebarDebugEntries,
  sidebarDebugEnabled,
  sidebarDebugLog,
  subscribeSidebarDebug,
} from '@/components/sidebar-debug'
import { useMountEffect } from '@/hooks/use-mount-effect'

const THROTTLED_EVENTS = new Set(['touchmove', 'scroll', 'pointermove'])
const THROTTLE_MS = 120

/**
 * On-screen event trace for the mobile-sidebar dismissal bug. Renders only
 * when `?sidebar-debug` was passed (see sidebar-debug.ts). Temporary.
 *
 * The log lines are written into the div imperatively (not via React state):
 * the trace must keep updating even while the surrounding tree is suspended
 * or transitioning, and must never influence the timing of the bug itself.
 */
export function SidebarDebugOverlay() {
  if (!sidebarDebugEnabled()) return null
  return <SidebarDebugOverlayActive />
}

function renderEntries(container: HTMLElement) {
  const entries = getSidebarDebugEntries()
  container.textContent = entries
    .map((entry, index) => {
      const prev = entries[index - 1]
      const delta = prev ? entry.at - prev.at : 0
      return `+${delta}ms ${entry.msg}`
    })
    .join('\n')
  container.scrollTop = container.scrollHeight
}

function SidebarDebugOverlayActive() {
  const router = useRouter()
  const containerRef = useRef<HTMLDivElement>(null)

  useMountEffect(() => {
    sidebarDebugLog('overlay armed')

    const lastLoggedAt = new Map<string, number>()
    const onEvent = (event: Event) => {
      if (THROTTLED_EVENTS.has(event.type)) {
        const last = lastLoggedAt.get(event.type) ?? 0
        if (event.timeStamp - last < THROTTLE_MS) return
        lastLoggedAt.set(event.type, event.timeStamp)
      }
      sidebarDebugLog(`${event.type} ${describeEventTarget(event.target)}`)
    }

    const eventTypes = [
      'touchstart',
      'touchmove',
      'touchend',
      'touchcancel',
      'pointerdown',
      'pointerup',
      'pointercancel',
      'click',
      'scroll',
      'focusin',
    ]
    for (const type of eventTypes) {
      document.addEventListener(type, onEvent, { capture: true, passive: true })
    }

    const unsubBeforeNavigate = router.subscribe('onBeforeNavigate', (event) =>
      sidebarDebugLog(`router onBeforeNavigate -> ${event.toLocation.href}`),
    )
    const unsubResolved = router.subscribe('onResolved', (event) =>
      sidebarDebugLog(
        `router onResolved path=${event.pathChanged} href=${event.hrefChanged}`,
      ),
    )

    const unsubscribeEntries = subscribeSidebarDebug(() => {
      if (containerRef.current) renderEntries(containerRef.current)
    })
    if (containerRef.current) renderEntries(containerRef.current)

    return () => {
      for (const type of eventTypes) {
        document.removeEventListener(type, onEvent, { capture: true })
      }
      unsubBeforeNavigate()
      unsubResolved()
      unsubscribeEntries()
    }
  })

  return (
    <div
      ref={containerRef}
      className="pointer-events-none fixed inset-x-0 bottom-0 z-200 max-h-56 overflow-hidden bg-black/85 p-1 font-mono text-[9px] leading-[11px] whitespace-pre-wrap text-green-300"
    />
  )
}
