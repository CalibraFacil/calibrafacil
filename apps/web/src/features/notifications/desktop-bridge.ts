import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { NotificationSummary } from '@calibra-facil/client-runtime'

import { calibraApi } from '@/utils/api'
import { unreadNotificationsQueryOptions } from './queries'

/** The host caps the array; sending a whole inbox would be pointless anyway. */
const PUBLISHED_ENTRY_LIMIT = 20

export function toPublishedEntries(notifications: NotificationSummary[]) {
  return notifications.slice(0, PUBLISHED_ENTRY_LIMIT).map((notification) => ({
    id: notification.id,
    title: notification.title,
    message: notification.message,
    status: notification.status,
    actionUrl: notification.actionUrl ?? null,
  }))
}

export function useDesktopNotificationBridge({
  enabled,
  organizationKey,
}: {
  enabled: boolean
  organizationKey: string
}) {
  const queryClient = useQueryClient()

  return useQuery({
    queryKey: ['notifications', organizationKey, 'desktop-bridge'],
    enabled,
    refetchInterval: 30_000,
    // Electron marks a minimized renderer as hidden, and TanStack Query stops
    // interval refetches in the background by default — which would switch
    // this off in exactly the situation native notifications exist for.
    refetchIntervalInBackground: true,
    // The host is the consumer; nothing renders from this.
    notifyOnChangeProps: [],
    queryFn: async () => {
      const bridge = window.calibraBridge
      if (!bridge) return { published: false }

      // `fetchQuery` reuses the unread count the notification centre already
      // polls, rather than opening a second counting request beside it. The
      // explicit `staleTime` matters: the two pollers start at different mount
      // times, so the centre's own 10s window frequently misses and this would
      // re-hit the network on almost every tick.
      const [unread, recent] = await Promise.all([
        queryClient.fetchQuery({
          ...unreadNotificationsQueryOptions(organizationKey),
          staleTime: 30_000,
        }),
        calibraApi.notifications.listRecent({
          query: {
            page: 1,
            limit: PUBLISHED_ENTRY_LIMIT,
            status: 'UNREAD',
          },
        }),
      ])

      const entries = recent.data ?? []

      await bridge
        .publishNotifications({
          // The host keeps its seen-set per scope: without this, switching
          // organizations leaves the new one already "primed", and its unread
          // backlog is announced as newly arrived.
          organizationKey,
          unreadCount: unread.count,
          // Only the first page is sent, so an account with more unread than
          // that would later expose older rows the host has never seen and
          // announce them as new. The highest id on the priming page bounds
          // that: anything at or below it already existed.
          highWaterMarkId: highestNotificationId(entries),
          entries: toPublishedEntries(entries),
        })
        .catch(() => undefined)

      return { published: true }
    },
  })
}

/**
 * The highest notification id on a page.
 *
 * Ids are monotonic, so this is a cheap "everything at or below this already
 * existed" marker — which is what lets the host seed a backlog larger than one
 * page without announcing it later.
 */
function highestNotificationId(
  notifications: readonly { id: number }[],
): number | null {
  let highest: number | null = null

  for (const notification of notifications) {
    if (highest === null || notification.id > highest) highest = notification.id
  }

  return highest
}
