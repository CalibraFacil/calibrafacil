import * as React from 'react'

function subscribe(callback: () => void) {
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  mediaQuery.addEventListener('change', callback)
  return () => mediaQuery.removeEventListener('change', callback)
}

function getSnapshot() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function usePrefersDark() {
  return React.useSyncExternalStore(subscribe, getSnapshot, () => false)
}
