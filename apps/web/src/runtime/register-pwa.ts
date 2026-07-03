import { registerSW } from 'virtual:pwa-register'
import { isDesktopRuntime } from '@/runtime/desktop'

export function registerPwa() {
  // The Electron shell has its own offline story (local-server + sync);
  // a service worker there would fight the desktop runtime.
  if (isDesktopRuntime()) return
  if (!('serviceWorker' in navigator)) return

  registerSW({ immediate: true })
}
