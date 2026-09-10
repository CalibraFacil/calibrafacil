import { useRef, useState } from 'react'

import { useMountEffect } from '@/hooks/use-mount-effect'

const TICK_MS = 250

/**
 * A whole-second countdown driven off a wall-clock deadline, so it stays honest
 * when the tab is throttled or backgrounded instead of drifting one interval at
 * a time.
 *
 * Ticking is started from an event handler (never a render effect) and the
 * interval is torn down on unmount.
 */
export function useCountdown() {
  const [secondsLeft, setSecondsLeft] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function stop() {
    if (intervalRef.current === null) return
    clearInterval(intervalRef.current)
    intervalRef.current = null
  }

  useMountEffect(() => stop)

  function start(seconds: number) {
    stop()

    const deadline = Date.now() + seconds * 1000
    setSecondsLeft(seconds)

    intervalRef.current = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
      setSecondsLeft(remaining)
      if (remaining === 0) stop()
    }, TICK_MS)
  }

  function reset() {
    stop()
    setSecondsLeft(0)
  }

  return { secondsLeft, start, reset }
}
