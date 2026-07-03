import { isDesktopRuntime } from '@/runtime/desktop'

/**
 * True when the app is running as an installed PWA (launched from the home
 * screen / app list), as opposed to a regular browser tab. The Electron
 * desktop shell is excluded — it has its own runtime detection.
 */
export function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false
  if (isDesktopRuntime()) return false
  if (window.matchMedia('(display-mode: standalone)').matches) return true
  return isIosStandalone(window.navigator)
}

// iOS Safari exposes the non-standard `navigator.standalone` for home-screen
// web apps; typing it via the parameter avoids a banned `as` assertion.
function isIosStandalone(nav: Navigator & { standalone?: unknown }): boolean {
  return nav.standalone === true
}
