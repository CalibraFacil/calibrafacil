import type { ReactNode } from 'react'
import { useRouter } from '@tanstack/react-router'

import { useMountEffect } from '@/hooks/use-mount-effect'
import { subscribeToDeepLinks } from '@/runtime/deep-link-navigation'
import {
  installHistoryShortcuts,
  shortcutPlatformFor,
} from '@/runtime/history-shortcuts'

/**
 * Desktop shell integration that has to outlive every navigation: OS deep
 * links, and back/forward.
 *
 * Lives here rather than in `__root.tsx` because route files are held to a
 * thin boundary — `createFileRoute`, loaders, `head`, search validation and
 * small prop adapters. Wiring the host lifecycle into a route file puts a
 * substantial amount of non-routing behaviour where the repository's
 * architecture rules say it must not go.
 *
 * It renders its children unchanged; being a component is only what gives the
 * subscriptions a mount point at the top of the tree.
 */
export function DesktopLifecycleProvider({
  children,
  isDesktop,
}: {
  children: ReactNode
  isDesktop: boolean
}) {
  useDeepLinkNavigation(isDesktop)
  useHistoryShortcuts(isDesktop)

  return <>{children}</>
}

/**
 * Route `calibrafacil://` links once the router exists. Mounted at the top so
 * the subscription outlives every navigation, including the one a link itself
 * triggers.
 */
function useDeepLinkNavigation(isDesktop: boolean) {
  const router = useRouter()

  useMountEffect(() => {
    if (!isDesktop || typeof window === 'undefined') return

    const bridge = window.calibraBridge
    if (!bridge) return

    return subscribeToDeepLinks(router, bridge)
  })
}

/**
 * Back/forward in a window with no menu bar. The browser provides these; an
 * Electron shell does not, so a user who drills into a job has no way back
 * except the in-page control.
 */
function useHistoryShortcuts(isDesktop: boolean) {
  const router = useRouter()

  useMountEffect(() => {
    if (!isDesktop || typeof window === 'undefined') return

    const bridge = window.calibraBridge
    if (!bridge) return

    // The host is asked for its platform rather than the renderer sniffing a
    // user agent it has itself overridden.
    let dispose: (() => void) | null = null
    let cancelled = false

    void bridge
      .getAppInfo()
      .then((info) => {
        if (cancelled) return

        dispose = installHistoryShortcuts({
          navigator: router.history,
          platform: shortcutPlatformFor(info.platform),
          bridge,
        })
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
      dispose?.()
    }
  })
}
