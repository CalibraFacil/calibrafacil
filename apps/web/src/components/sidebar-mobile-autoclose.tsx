import { useRouter } from '@tanstack/react-router'

import { useSidebar } from '@/components/ui/sidebar'
import { useMountEffect } from '@/hooks/use-mount-effect'

/**
 * Dismisses the mobile sidebar sheet whenever a navigation resolves.
 *
 * On desktop the sidebar is a persistent rail, so `setOpenMobile(false)` is a
 * harmless no-op (the value is already `false`). On mobile the sidebar is an
 * off-canvas `Sheet`, and the shadcn sidebar does not close it when a nav link
 * is tapped — without this it stays open covering the page the user just
 * navigated to. Subscribing once to the router covers every link in the
 * sidebar (nav-main, sub-items, secondary links, the user menu and the org
 * switcher) without wiring an `onClick` into each one.
 */
export function SidebarMobileAutoClose() {
  const router = useRouter()
  const { setOpenMobile } = useSidebar()

  useMountEffect(() =>
    router.subscribe('onResolved', () => {
      setOpenMobile(false)
    }),
  )

  return null
}
