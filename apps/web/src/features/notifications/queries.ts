import { queryOptions, useQuery } from '@tanstack/react-query'

import { calibraApi } from '@/utils/api'
import type {
  NotificationsListResponse,
  UnreadNotificationsResponse,
} from '@calibra-facil/client-runtime'

export function unreadNotificationsQueryOptions(organizationKey: string) {
  return queryOptions({
    queryKey: ['notifications', organizationKey, 'unread-count'],
    queryFn: async (): Promise<UnreadNotificationsResponse> =>
      calibraApi.notifications.getUnreadCount(),
    refetchInterval: 30_000,
    staleTime: 10_000,
  })
}

export function recentNotificationsQueryOptions(organizationKey: string) {
  return queryOptions({
    queryKey: ['notifications', organizationKey, 'recent'],
    queryFn: async (): Promise<NotificationsListResponse> =>
      calibraApi.notifications.listRecent({
        page: 1,
        limit: 5,
      }),
    staleTime: 5_000,
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

export function useRecentNotificationsData({
  enabled,
  organizationKey,
}: {
  enabled: boolean
  organizationKey: string
}) {
  return useQuery({
    ...recentNotificationsQueryOptions(organizationKey),
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
    queryKey: ['notifications', organizationKey, 'inbox', { page, unreadOnly }],
    queryFn: () =>
      calibraApi.notifications.listRecent({
        page,
        limit: 15,
        ...(unreadOnly ? { status: 'UNREAD' as const } : {}),
      }),
    enabled,
    staleTime: 5_000,
  })
}
