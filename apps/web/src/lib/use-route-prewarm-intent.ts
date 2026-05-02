import { useEffect, useMemo, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'

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

export function createRoutePrewarmIntent(
  prewarmFn: PrewarmFn,
  options: UseRoutePrewarmIntentOptions = {},
) {
  const debounceMs = options.debounceMs ?? PREWARM_DEBOUNCE_MS
  let timer: ReturnType<typeof setTimeout> | undefined

  const cancel = () => {
    if (!timer) return
    clearTimeout(timer)
    timer = undefined
  }

  const schedule = () => {
    if (timer) return

    timer = setTimeout(() => {
      timer = undefined
      Promise.resolve(prewarmFn()).catch(() => {
        // Prewarming is opportunistic; navigation owns visible errors.
      })
    }, debounceMs)
  }

  return {
    handlers: {
      onMouseEnter: schedule,
      onFocus: schedule,
      onTouchStart: schedule,
      onMouseLeave: cancel,
      onBlur: cancel,
    } satisfies RoutePrewarmIntentHandlers,
    cancel,
  }
}

export function useRoutePrewarmIntent(
  prewarmFn: PrewarmFn,
  options: UseRoutePrewarmIntentOptions = {},
): RoutePrewarmIntentHandlers {
  const prewarmRef = useRef(prewarmFn)
  prewarmRef.current = prewarmFn

  const debounceMs = options.debounceMs
  const controller = useMemo(
    () =>
      createRoutePrewarmIntent(() => prewarmRef.current(), {
        debounceMs,
      }),
    [debounceMs],
  )

  useEffect(() => {
    return () => {
      controller.cancel()
    }
  }, [controller])

  return controller.handlers
}

export function usePathPrewarmIntent(
  path: string | null | undefined,
  options: UseRoutePrewarmIntentOptions = {},
) {
  const queryClient = useQueryClient()

  return useRoutePrewarmIntent(() => {
    if (!path || typeof window === 'undefined') return

    const url = new URL(path, window.location.href)
    if (url.origin !== window.location.origin) return

    return import('@/lib/route-prewarm').then(({ prewarmRouteDataForPath }) =>
      prewarmRouteDataForPath(url, queryClient),
    )
  }, options)
}
