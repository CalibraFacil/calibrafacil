import * as React from 'react'

export function useDebouncedValue<T>(value: T, delay: number): T {
  void delay
  return React.useDeferredValue(value)
}
