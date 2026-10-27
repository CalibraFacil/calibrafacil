import { queryOptions, useQuery } from '@tanstack/react-query'

import { calibraApi } from '@/utils/api'

export function openSyncConflictsQueryOptions() {
  return queryOptions({
    queryKey: ['desktop-sync-conflicts', 'open'],
    queryFn: () => calibraApi.sync.listConflicts({ status: 'open' }),
  })
}

export function useOpenSyncConflictsData({ enabled }: { enabled: boolean }) {
  return useQuery({
    ...openSyncConflictsQueryOptions(),
    enabled,
  })
}

export function blockedSyncEventsQueryOptions() {
  return queryOptions({
    queryKey: ['desktop-sync-blocked-events'],
    queryFn: () => calibraApi.sync.listBlockedEvents(),
  })
}

export function useBlockedSyncEventsData({ enabled }: { enabled: boolean }) {
  return useQuery({
    ...blockedSyncEventsQueryOptions(),
    enabled,
  })
}

export function deadSyncEventsQueryOptions() {
  return queryOptions({
    queryKey: ['desktop-sync-dead-events'],
    queryFn: () => calibraApi.sync.listDeadEvents(),
  })
}

export function useDeadSyncEventsData({ enabled }: { enabled: boolean }) {
  return useQuery({
    ...deadSyncEventsQueryOptions(),
    enabled,
  })
}
