import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { useMountEffect } from '@/hooks/use-mount-effect'
import { isDesktopRuntime } from '@/runtime/desktop'

const PREWARM_DEBOUNCE_MS = 120

type PrewarmFn = () => void | Promise<void>

type UseRoutePrewarmIntentOptions = {
  debounceMs?: number
}

type RoutePrewarmIntentHandlers = {
  onMouseEnter: () => void
  onFocus: () => void
  onTouchStart: () => void
  onMouseLeave: () => void
  onBlur: () => void
}

/**
 * Debounce box for hover/focus prewarm intent. The callback is supplied per
 * `schedule` call rather than captured at construction, so the box can stay
 * stable across renders without a render-time ref write.
 */
export function createRoutePrewarmIntent(
  options: UseRoutePrewarmIntentOptions = {},
) {
  const debounceMs = options.debounceMs ?? PREWARM_DEBOUNCE_MS
  let timer: ReturnType<typeof setTimeout> | undefined

  const cancel = () => {
    if (!timer) return
    clearTimeout(timer)
    timer = undefined
  }

  const schedule = (prewarmFn: PrewarmFn) => {
    if (timer) return

    timer = setTimeout(() => {
      timer = undefined
      Promise.resolve(prewarmFn()).catch(() => {
        // Prewarming is opportunistic; navigation owns visible errors.
      })
    }, debounceMs)
  }

  return { schedule, cancel }
}

export function useRoutePrewarmIntent(
  prewarmFn: PrewarmFn,
  options: UseRoutePrewarmIntentOptions = {},
): RoutePrewarmIntentHandlers {
  const debounceMs = options.debounceMs
  const [controller] = useState(() => createRoutePrewarmIntent({ debounceMs }))

  useMountEffect(() => {
    return () => {
      controller.cancel()
    }
  })

  // Handlers are rebuilt each render and close over this render's `prewarmFn`,
  // which is what keeps the controller itself stable and ref-free.
  const schedule = () => {
    controller.schedule(prewarmFn)
  }

  return {
    onMouseEnter: schedule,
    onFocus: schedule,
    onTouchStart: schedule,
    onMouseLeave: controller.cancel,
    onBlur: controller.cancel,
  }
}

export function usePathPrewarmIntent(
  path: string | null | undefined,
  options: UseRoutePrewarmIntentOptions = {},
) {
  const queryClient = useQueryClient()

  return useRoutePrewarmIntent(() => {
    if (!path || typeof window === 'undefined') return
    const url = resolvePrewarmUrl(path, window.location.href, {
      isDesktop: isDesktopRuntime(),
    })
    if (!url) return

    return import('@/lib/route-prewarm').then(({ prewarmRouteDataForPath }) =>
      prewarmRouteDataForPath(url, queryClient),
    )
  }, options)
}

export function resolvePrewarmUrl(
  path: string | null | undefined,
  currentHref: string,
  options: { isDesktop?: boolean } = {},
) {
  if (!path || options.isDesktop) return null

  const url = new URL(path, currentHref)
  const currentUrl = new URL(currentHref)

  if (url.origin !== currentUrl.origin) return null

  return url
}
