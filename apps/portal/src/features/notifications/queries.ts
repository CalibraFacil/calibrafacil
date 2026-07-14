import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { getApiBaseUrl } from "@/lib/utils";
import type { PortalNotificationType } from "./lib";

/**
 * General in-app notification center (issue #741). Shapes mirror
 * apps/api/src/routes/portal-notifications.ts and the portal
 * notification-preferences endpoints in portal.ts.
 */

export type PortalNotificationItem = {
  id: number;
  type: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
  status: "UNREAD" | "READ" | "ARCHIVED";
  title: string;
  message: string;
  actionUrl: string | null;
  createdAt: string;
  readAt: string | null;
};

export type NotificationFeedPage = {
  data: Array<PortalNotificationItem>;
  nextCursor: number | null;
};

export type NotificationChannels = { inApp: boolean; email: boolean };

export type NotificationPreferences = {
  digestFrequency: "NONE" | "DAILY" | "WEEKLY";
  emailEnabled: boolean;
  preferences: Partial<Record<PortalNotificationType, NotificationChannels>>;
};

export const NOTIFICATION_FEED_QUERY_KEY = ["portal-notification-feed"];
export const NOTIFICATION_COUNT_QUERY_KEY = ["portal-notification-count"];
export const NOTIFICATION_PREFERENCES_QUERY_KEY = [
  "portal-notification-preferences",
];

async function throwResponseError(
  response: Response,
  fallback: string,
): Promise<never> {
  const body: unknown = await response.json().catch(() => null);
  if (
    body !== null &&
    typeof body === "object" &&
    "error" in body &&
    typeof body.error === "string"
  ) {
    throw new Error(body.error);
  }
  throw new Error(fallback);
}

/**
 * Bell badge. Polled — the portal has no realtime channel by design; a
 * once-a-minute count is plenty for a surface visited a few times a week.
 */
export function useUnreadNotificationCount() {
  return useQuery({
    queryKey: NOTIFICATION_COUNT_QUERY_KEY,
    queryFn: async (): Promise<number> => {
      const response = await fetch(
        `${getApiBaseUrl()}/api/portal/notifications/unread-count`,
        { credentials: "include" },
      );
      if (!response.ok) {
        return throwResponseError(
          response,
          "Falha ao carregar as notificações.",
        );
      }
      const result: { count: number } = await response.json();
      return result.count;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

/** Cursor-paginated feed; fetched only while the popover/page is open. */
export function useNotificationFeed(enabled: boolean) {
  return useInfiniteQuery({
    queryKey: NOTIFICATION_FEED_QUERY_KEY,
    queryFn: async ({
      pageParam,
    }: {
      pageParam: number | undefined;
    }): Promise<NotificationFeedPage> => {
      const params = new URLSearchParams({ limit: "20" });
      if (pageParam !== undefined) params.set("cursor", String(pageParam));
      const response = await fetch(
        `${getApiBaseUrl()}/api/portal/notifications?${params}`,
        { credentials: "include" },
      );
      if (!response.ok) {
        return throwResponseError(
          response,
          "Falha ao carregar as notificações.",
        );
      }
      const result: NotificationFeedPage = await response.json();
      return result;
    },
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled,
    staleTime: 15_000,
  });
}

function useInvalidateNotifications() {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: NOTIFICATION_FEED_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: NOTIFICATION_COUNT_QUERY_KEY }),
    ]);
  };
}

export function useMarkNotificationsRead() {
  const invalidate = useInvalidateNotifications();
  return useMutation({
    mutationFn: async (notificationIds: Array<number>): Promise<void> => {
      const response = await fetch(
        `${getApiBaseUrl()}/api/portal/notifications/mark-read`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notificationIds }),
        },
      );
      if (!response.ok) {
        return throwResponseError(
          response,
          "Não foi possível marcar como lida.",
        );
      }
    },
    onSuccess: invalidate,
  });
}

export function useMarkAllNotificationsRead() {
  const invalidate = useInvalidateNotifications();
  return useMutation({
    mutationFn: async (): Promise<void> => {
      const response = await fetch(
        `${getApiBaseUrl()}/api/portal/notifications/mark-all-read`,
        { method: "POST", credentials: "include" },
      );
      if (!response.ok) {
        return throwResponseError(
          response,
          "Não foi possível marcar todas como lidas.",
        );
      }
    },
    onSuccess: invalidate,
  });
}

export function useNotificationPreferences() {
  return useQuery({
    queryKey: NOTIFICATION_PREFERENCES_QUERY_KEY,
    queryFn: async (): Promise<NotificationPreferences> => {
      const response = await fetch(
        `${getApiBaseUrl()}/api/portal/notification-preferences`,
        { credentials: "include" },
      );
      if (!response.ok) {
        return throwResponseError(response, "Falha ao carregar preferências.");
      }
      const result: NotificationPreferences = await response.json();
      return result;
    },
  });
}

export type UpdatePreferencesInput = {
  digestFrequency?: "NONE" | "DAILY" | "WEEKLY";
  emailEnabled?: boolean;
  preferences?: Partial<Record<PortalNotificationType, NotificationChannels>>;
};

/**
 * Optimistic: toggles must flip instantly. The cache is patched from the
 * partial input; on error it rolls back, and it always settles by refetching
 * the server truth.
 */
export function useUpdateNotificationPreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: UpdatePreferencesInput,
    ): Promise<NotificationPreferences> => {
      const response = await fetch(
        `${getApiBaseUrl()}/api/portal/notification-preferences`,
        {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      if (!response.ok) {
        return throwResponseError(response, "Falha ao salvar preferências.");
      }
      const result: NotificationPreferences = await response.json();
      return result;
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({
        queryKey: NOTIFICATION_PREFERENCES_QUERY_KEY,
      });
      const previous = queryClient.getQueryData<NotificationPreferences>(
        NOTIFICATION_PREFERENCES_QUERY_KEY,
      );
      if (previous) {
        queryClient.setQueryData<NotificationPreferences>(
          NOTIFICATION_PREFERENCES_QUERY_KEY,
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
          NOTIFICATION_PREFERENCES_QUERY_KEY,
          context.previous,
        );
      }
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({
        queryKey: NOTIFICATION_PREFERENCES_QUERY_KEY,
      });
    },
  });
}
