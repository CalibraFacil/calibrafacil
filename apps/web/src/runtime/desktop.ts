import { isDesktopRuntime as detectDesktopRuntime } from '@calibra-facil/client-runtime'

export function isDesktopRuntime() {
  return detectDesktopRuntime()
}
