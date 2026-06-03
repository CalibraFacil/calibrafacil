import { useEffect } from 'react'

export function useMountEffect(effect: () => void | (() => void)) {
  /* eslint-disable no-restricted-syntax */
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- useMountEffect intentionally runs only once.
  useEffect(effect, []) // react-doctor-disable-line react-doctor/exhaustive-deps -- effect is a parameter; deps cannot be statically verified by design
}
