import { queryOptions, useQuery } from '@tanstack/react-query'

import { calibraApi } from '@/utils/api'
import type { UnreadNotificationsResponse } from '@calibra-facil/client-runtime'
import { notificationKeys } from '@/features/notifications/keys'

export function unreadNotificationsQueryOptions(organizationKey: string) {
  return queryOptions({
    queryKey: notificationKeys.unreadCount(organizationKey),
    queryFn: async (): Promise<UnreadNotificationsResponse> =>
      calibraApi.notifications.getUnreadCount(),
    refetchInterval: 30_000,
    staleTime: 10_000,
  })
}

export function useUnreadNotificationsData({
  enabled,
  organizationKey,
}: {
  enabled: boolean
  organizationKey: string
}) {
  return useQuery({
    ...unreadNotificationsQueryOptions(organizationKey),
    enabled,
  })
}

export function useNotificationCenterData({
  organizationKey,
  enabled,
  page,
  unreadOnly,
}: {
  organizationKey: string
  enabled: boolean
  page: number
  unreadOnly: boolean
}) {
  return useQuery({
    queryKey: notificationKeys.inbox(organizationKey, { page, unreadOnly }),
    queryFn: () =>
      calibraApi.notifications.listRecent({
        query: {
          page,
          limit: 15,
          ...(unreadOnly ? { status: 'UNREAD' as const } : {}),
        },
      }),
    enabled,
    staleTime: 5_000,
  })
}
