import { queryOptions, useQuery } from '@tanstack/react-query'

import { calibraApi } from '@/utils/api'
import type {
  NotificationsListResponse,
  UnreadNotificationsResponse,
} from '@calibra-facil/client-runtime'

export function unreadNotificationsQueryOptions(organizationKey: string) {
  return queryOptions({
    queryKey: ['notifications', organizationKey, 'unread-count'],
    queryFn: () =>
      calibraApi.notifications.getUnreadCount() as Promise<UnreadNotificationsResponse>,
    refetchInterval: 30_000,
    staleTime: 10_000,
  })
}

export function recentNotificationsQueryOptions(organizationKey: string) {
  return queryOptions({
    queryKey: ['notifications', organizationKey, 'recent'],
    queryFn: () =>
      calibraApi.notifications.listRecent({
        page: 1,
        limit: 5,
      }) as Promise<NotificationsListResponse>,
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
