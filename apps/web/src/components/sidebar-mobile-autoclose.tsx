import { useRouter } from '@tanstack/react-router'

import { sidebarDebugLog } from '@/components/sidebar-debug'
import { useSidebar } from '@/components/ui/sidebar'
import { useMountEffect } from '@/hooks/use-mount-effect'

/**
 * Dismisses the mobile sidebar sheet on navigation.
 *
 * On desktop the sidebar is a persistent rail, so `setOpenMobile(false)` is a
 * harmless no-op (the value is already `false`). On mobile the sidebar is an
 * off-canvas `Sheet`, and the shadcn sidebar does not close it when a nav link
 * is tapped — without this it stays open covering the page the user just
 * navigated to. Subscribing once to the router covers every link in the
 * sidebar (nav-main, sub-items, secondary links, the user menu and the org
 * switcher) without wiring an `onClick` into each one.
 *
 * We subscribe to two events:
 * - `onBeforeNavigate` fires the moment a navigation is committed and is
 *   emitted unconditionally inside `router.load()` — including for a tap on the
 *   link of the page you are already on (same-URL navigations still run
 *   `load()`). This is the deterministic "user wants to dismiss" signal and
 *   fires early, so the sheet slides away as soon as the link is tapped.
 * - `onResolved` fires once the navigation settles; it is a fallback for paths
 *   that reach a new location without an `onBeforeNavigate` of their own (e.g.
 *   the target of a redirect, where the initial event is suppressed).
 *
 * `onResolved` must only close when the location actually changed: route
 * PRELOADS (the nav links' prewarm-on-touch intent) also settle through an
 * `onResolved` with `pathChanged`/`hrefChanged` both false. Closing on those
 * dismissed the sheet mid-scroll on touch devices — dragging across a link
 * scheduled a prewarm and the sheet vanished under the user's finger. The
 * deliberate "tap the current page's link still dismisses" behavior is not
 * affected: that is a real (same-URL) navigation and comes in through
 * `onBeforeNavigate`.
 */
export function SidebarMobileAutoClose() {
  const router = useRouter()
  const { setOpenMobile } = useSidebar()

  useMountEffect(() => {
    const close = () => setOpenMobile(false)
    const unsubscribeBeforeNavigate = router.subscribe(
      'onBeforeNavigate',
      (event) => {
        sidebarDebugLog(`autoclose onBeforeNavigate ${event.toLocation.href}`)
        close()
      },
    )
    const unsubscribeResolved = router.subscribe('onResolved', (event) => {
      if (!event.pathChanged && !event.hrefChanged) return
      sidebarDebugLog('autoclose onResolved (location changed)')
      close()
    })

    return () => {
      unsubscribeBeforeNavigate()
      unsubscribeResolved()
    }
  })

  return null
}
