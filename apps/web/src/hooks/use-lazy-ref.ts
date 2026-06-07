import { RefObject, useRef } from 'react'
function useLazyRef<T>(fn: () => T) {
  const ref = useRef<RefObject<T> | null>(null)

  if (ref.current === null) {
    let value: T
    let initialized = false
    ref.current = {
      get current() {
        if (!initialized) {
          value = fn()
          initialized = true
        }

        return value
      },
    }
  }

  return ref.current
}

export { useLazyRef }
