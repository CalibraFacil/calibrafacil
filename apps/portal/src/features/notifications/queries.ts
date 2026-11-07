import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import type {
  PortalNotificationFeedResponse,
  PortalNotificationPreferencesResponse,
} from "@calibra-facil/contracts/portal-client";
import type { PortalNotificationType } from "@calibra-facil/schemas";

import { usePortalKeys } from "@/lib/portal-keys";
import { portalApi } from "@/lib/portal-api";

/**
 * General in-app notification center. The shapes are the
 * contracts of `/api/portal/notifications` and `/notification-preferences`.
 */

export type NotificationFeedPage = PortalNotificationFeedResponse;
export type PortalNotificationItem = NotificationFeedPage["data"][number];

export type NotificationPreferences = PortalNotificationPreferencesResponse;
export type NotificationChannels =
  NotificationPreferences["preferences"][string];

/**
 * Bell badge. Polled — the portal has no realtime channel by design; a
 * once-a-minute count is plenty for a surface visited a few times a week.
 */
export function useUnreadNotificationCount() {
  const keys = usePortalKeys();
  return useQuery({
    queryKey: keys.notificationCount,
    queryFn: async (): Promise<number> => {
      const result = await portalApi.notifications.unreadCount(undefined, {
        serverErrorMessage: true,
      });
      return result.count;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

/** Cursor-paginated feed; fetched only while the popover/page is open. */
export function useNotificationFeed(enabled: boolean) {
  const keys = usePortalKeys();
  return useInfiniteQuery({
    queryKey: keys.notificationFeed,
    queryFn: async ({
      pageParam,
    }: {
      pageParam: number | undefined;
    }): Promise<NotificationFeedPage> => {
      return portalApi.notifications.list(
        { query: { limit: 20, cursor: pageParam } },
        { serverErrorMessage: true },
      );
    },
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled,
    staleTime: 15_000,
  });
}

function useInvalidateNotifications() {
  const keys = usePortalKeys();
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.notificationFeed }),
      queryClient.invalidateQueries({
        queryKey: keys.notificationCount,
      }),
    ]);
  };
}

export function useMarkNotificationsRead() {
  const invalidate = useInvalidateNotifications();
  return useMutation({
    mutationFn: async (notificationIds: Array<number>): Promise<void> => {
      await portalApi.notifications.markRead(
        { body: { notificationIds } },
        { serverErrorMessage: true },
      );
    },
    onSuccess: invalidate,
  });
}

export function useMarkAllNotificationsRead() {
  const invalidate = useInvalidateNotifications();
  return useMutation({
    mutationFn: async (): Promise<void> => {
      await portalApi.notifications.markAllRead(undefined, {
        serverErrorMessage: true,
      });
    },
    onSuccess: invalidate,
  });
}

export function useNotificationPreferences() {
  const keys = usePortalKeys();
  return useQuery({
    queryKey: keys.notificationPreferences,
    queryFn: async (): Promise<NotificationPreferences> => {
      return portalApi.notifications.preferences(undefined, {
        serverErrorMessage: true,
      });
    },
  });
}

export type UpdatePreferencesInput = {
  digestFrequency?: NotificationPreferences["digestFrequency"];
  emailEnabled?: boolean;
  preferences?: Partial<Record<PortalNotificationType, NotificationChannels>>;
};

/**
 * Optimistic: toggles must flip instantly. The cache is patched from the
 * partial input; on error it rolls back, and it always settles by refetching
 * the server truth.
 */
export function useUpdateNotificationPreferences() {
  const keys = usePortalKeys();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: UpdatePreferencesInput,
    ): Promise<NotificationPreferences> => {
      return portalApi.notifications.updatePreferences(
        { body: input },
        { serverErrorMessage: true },
      );
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({
        queryKey: keys.notificationPreferences,
      });
      const previous = queryClient.getQueryData<NotificationPreferences>(
        keys.notificationPreferences,
      );
      if (previous) {
        queryClient.setQueryData<NotificationPreferences>(
          keys.notificationPreferences,
          {
            digestFrequency: input.digestFrequency ?? previous.digestFrequency,
            emailEnabled: input.emailEnabled ?? previous.emailEnabled,
            preferences: { ...previous.preferences, ...input.preferences },
          },
        );
      }
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          keys.notificationPreferences,
          context.previous,
        );
      }
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({
        queryKey: keys.notificationPreferences,
      });
    },
  });
}
