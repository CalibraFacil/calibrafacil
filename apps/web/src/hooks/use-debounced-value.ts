import { useDeferredValue } from 'react'
export function useDebouncedValue<T>(value: T, delay: number): T {
  void delay
  return useDeferredValue(value)
}
