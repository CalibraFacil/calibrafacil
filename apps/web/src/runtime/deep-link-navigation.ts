import type { AnyRouter } from '@tanstack/react-router'

/**
 * Deliver an OS deep link to the router.
 *
 * The main process has already validated that the path is a same-app route
 * (see `apps/desktop/src/main/deep-links.ts`); this side is only responsible
 * for navigating and for not swallowing a link that arrives before the router
 * is listening.
 *
 * Authorization is unchanged. The link becomes an ordinary navigation, so a
 * route the user may not see resolves to the same denial it would from the
 * sidebar — a deep link cannot be used to reach a screen the sidebar hides.
 */
export type DeepLinkBridge = {
  onDeepLink(listener: (path: string) => void): () => void
  notifyDeepLinkReady(): Promise<boolean>
}

export function subscribeToDeepLinks(
  router: Pick<AnyRouter, 'navigate'>,
  bridge: DeepLinkBridge,
) {
  const unsubscribe = bridge.onDeepLink((path) => {
    // `href` rather than `to`: the path is a runtime string, not one of the
    // router's known literal route ids, and it may already carry search and
    // hash from the link.
    void router.navigate({ href: path })
  })

  // Announce only after the listener exists, so a link buffered during a cold
  // launch cannot be flushed into a renderer that is not subscribed yet.
  void bridge.notifyDeepLinkReady().catch(() => undefined)

  return unsubscribe
}
