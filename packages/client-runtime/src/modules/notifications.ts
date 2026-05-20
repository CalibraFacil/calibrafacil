import type {
  NotificationPreferencesResponse,
  NotificationsApi,
  NotificationsListResponse,
  UnreadNotificationsResponse,
} from "../types";

export function createNotificationsApi(rawCloudClient: any): NotificationsApi {
  return {
    async getUnreadCount() {
      const response =
        await rawCloudClient.api.notifications["unread-count"].$get();

      if (!response.ok) {
        throw new Error("Failed to fetch unread count");
      }

      return response.json() as Promise<UnreadNotificationsResponse>;
    },
    async listRecent(input = {}) {
      const response = await rawCloudClient.api.notifications.$get({
        query: {
          page: String(input.page ?? 1),
          limit: String(input.limit ?? 5),
        },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch notifications");
      }

      return response.json() as Promise<NotificationsListResponse>;
    },
    async markRead(notificationIds) {
      const response = await rawCloudClient.api.notifications[
        "mark-read"
      ].$post({
        json: { notificationIds },
      });

      if (!response.ok) {
        throw new Error("Failed to mark as read");
      }

      return response.json();
    },
    async markAllRead() {
      const response =
        await rawCloudClient.api.notifications["mark-all-read"].$post();

      if (!response.ok) {
        throw new Error("Failed to mark all as read");
      }

      return response.json();
    },
    async getPreferences() {
      const response =
        await rawCloudClient.api.notifications.preferences.$get();

      if (!response.ok) {
        throw new Error("Failed to fetch preferences");
      }

      return response.json() as Promise<NotificationPreferencesResponse>;
    },
    async updatePreferences(input) {
      const response = await rawCloudClient.api.notifications.preferences.$put({
        json: input,
      });

      if (!response.ok) {
        throw new Error("Failed to update preferences");
      }

      return response.json() as Promise<NotificationPreferencesResponse>;
    },
  };
}
