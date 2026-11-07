import { queryOptions, useQuery } from '@tanstack/react-query'

import { calibraApi } from '@/utils/api'
import { syncKeys } from '@/features/sync/keys'

export function openSyncConflictsQueryOptions() {
  return queryOptions({
    queryKey: syncKeys.openConflicts,
    queryFn: () => calibraApi.sync.listConflicts({ status: 'open' }),
  })
}

export function useOpenSyncConflictsData({ enabled }: { enabled: boolean }) {
  return useQuery({
    ...openSyncConflictsQueryOptions(),
    enabled,
  })
}

function blockedSyncEventsQueryOptions() {
  return queryOptions({
    queryKey: syncKeys.blockedEvents,
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
    queryKey: syncKeys.deadEvents,
    queryFn: () => calibraApi.sync.listDeadEvents(),
  })
}

export function useDeadSyncEventsData({ enabled }: { enabled: boolean }) {
  return useQuery({
    ...deadSyncEventsQueryOptions(),
    enabled,
  })
}
