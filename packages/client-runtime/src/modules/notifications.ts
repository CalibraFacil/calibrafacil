import type {
  NotificationPreferencesResponse,
  NotificationsApi,
  NotificationsListResponse,
  UnreadNotificationsResponse,
} from "../types";
import { readJsonResponse, readMutationResponse } from "../transport/response";

export function createNotificationsApi(rawCloudClient: any): NotificationsApi {
  return {
    async getUnreadCount() {
      return readJsonResponse<UnreadNotificationsResponse>(
        await rawCloudClient.api.notifications["unread-count"].$get(),
        "Failed to fetch unread count",
      );
    },
    async listRecent(input = {}) {
      return readJsonResponse<NotificationsListResponse>(
        await rawCloudClient.api.notifications.$get({
          query: {
            page: String(input.page ?? 1),
            limit: String(input.limit ?? 5),
            ...(input.status ? { status: input.status } : {}),
          },
        }),
        "Failed to fetch notifications",
      );
    },
    async markRead(notificationIds) {
      return readMutationResponse(
        await rawCloudClient.api.notifications["mark-read"].$post({
          json: { notificationIds },
        }),
        "Failed to mark as read",
      );
    },
    async markAllRead() {
      return readMutationResponse(
        await rawCloudClient.api.notifications["mark-all-read"].$post(),
        "Failed to mark all as read",
      );
    },
    async getPreferences() {
      return readJsonResponse<NotificationPreferencesResponse>(
        await rawCloudClient.api.notifications.preferences.$get(),
        "Failed to fetch preferences",
      );
    },
    async updatePreferences(input) {
      return readJsonResponse<NotificationPreferencesResponse>(
        await rawCloudClient.api.notifications.preferences.$put({
          json: input,
        }),
        "Failed to update preferences",
      );
    },
  };
}
