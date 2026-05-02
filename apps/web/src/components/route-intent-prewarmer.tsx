import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'

import { prewarmRouteDataForPath } from '@/lib/route-prewarm'

function getAnchorFromEvent(event: Event) {
  const target = event.target
  if (!(target instanceof Element)) return null

  return target.closest<HTMLAnchorElement>('a[href]')
}

function shouldIgnorePointerOver(
  anchor: HTMLAnchorElement,
  event: PointerEvent,
) {
  const relatedTarget = event.relatedTarget

  return relatedTarget instanceof Node && anchor.contains(relatedTarget)
}

function getInternalUrl(anchor: HTMLAnchorElement) {
  if (anchor.target && anchor.target !== '_self') return null
  if (anchor.hasAttribute('download')) return null

  const url = new URL(anchor.href, window.location.href)
  if (url.origin !== window.location.origin) return null

  return url
}

export function RouteIntentPrewarmer() {
  const queryClient = useQueryClient()
  const router = useRouter()

  useEffect(() => {
    function prewarm(anchor: HTMLAnchorElement) {
      const url = getInternalUrl(anchor)
      if (!url) return

      const to = `${url.pathname}${url.search}`

      void router.preloadRoute({ to } as never).catch(() => {
        // Router preloads can be interrupted or rejected by route guards.
      })
      void prewarmRouteDataForPath(url, queryClient)
    }

    function handlePointerOver(event: PointerEvent) {
      const anchor = getAnchorFromEvent(event)
      if (!anchor || shouldIgnorePointerOver(anchor, event)) return

      prewarm(anchor)
    }

    function handleFocusIn(event: FocusEvent) {
      const anchor = getAnchorFromEvent(event)
      if (!anchor) return

      prewarm(anchor)
    }

    function handleTouchStart(event: TouchEvent) {
      const anchor = getAnchorFromEvent(event)
      if (!anchor) return

      prewarm(anchor)
    }

    document.addEventListener('pointerover', handlePointerOver)
    document.addEventListener('focusin', handleFocusIn)
    document.addEventListener('touchstart', handleTouchStart, { passive: true })

    return () => {
      document.removeEventListener('pointerover', handlePointerOver)
      document.removeEventListener('focusin', handleFocusIn)
      document.removeEventListener('touchstart', handleTouchStart)
    }
  }, [queryClient, router])

  return null
}
