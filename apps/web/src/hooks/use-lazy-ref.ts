import { RefObject, useState } from 'react'

/**
 * A ref-shaped box whose value is produced on first read instead of on every
 * render. `useState`'s lazy initializer keeps the box stable for the life of
 * the component, so nothing reads or writes a ref during render.
 */
function useLazyRef<T>(fn: () => T) {
  const [ref] = useState<RefObject<T>>(() => {
    let value: T
    let initialized = false

    return {
      get current() {
        if (!initialized) {
          value = fn()
          initialized = true
        }

        return value
      },
    }
  })

  return ref
}

export { useLazyRef }
