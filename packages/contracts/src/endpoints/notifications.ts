import { z } from "zod";
import {
  ListNotificationsQuerySchema,
  MarkNotificationsReadSchema,
  UpdateNotificationPreferencesSchema,
  DigestFrequencySchema,
} from "@calibra-facil/schemas";

import { nullableString, paginationSchema } from "../common";
import { endpoint, type EndpointGroup } from "./define";

/**
 * The signed-in user's in-app notifications and their preferences. Response
 * schemas are wire schemas written from what
 * `apps/api/src/domains/notifications/routes/notifications.ts` returns. Cloud-only: the desktop shell
 * answers an empty inbox and the default preferences locally
 * (`client-runtime/src/transport/desktop-client.ts`).
 *
 * Not client-facing, so not defined here: `DELETE /:id` (archive).
 */

const notificationSchema = z.object({
  id: z.number(),
  recipientUserId: z.string().optional(),
  organizationId: z.string().optional(),
  type: z.string(),
  priority: z.string(),
  status: z.string(),
  title: z.string(),
  message: z.string(),
  relatedEntity: z.unknown().optional(),
  actionUrl: nullableString.optional(),
  channelsSent: z.array(z.string()).optional(),
  readAt: nullableString.optional(),
  expiresAt: nullableString.optional(),
  createdAt: z.string(),
});
export type NotificationSummary = z.infer<typeof notificationSchema>;

/** GET /api/notifications */
export const notificationsListResponseSchema = z.object({
  data: z.array(notificationSchema),
  pagination: paginationSchema.optional(),
});
export type NotificationsListResponse = z.infer<
  typeof notificationsListResponseSchema
>;

/** GET /api/notifications/unread-count */
export const unreadNotificationsResponseSchema = z.object({
  count: z.number(),
});
export type UnreadNotificationsResponse = z.infer<
  typeof unreadNotificationsResponseSchema
>;

const notificationChannelsSchema = z.object({
  inApp: z.boolean(),
  email: z.boolean(),
});

/** GET and PUT /api/notifications/preferences (the PUT adds a `message`). */
export const notificationPreferencesResponseSchema = z.object({
  message: z.string().optional(),
  preferences: z.partialRecord(z.string(), notificationChannelsSchema),
  emailEnabled: z.boolean(),
  notifySelfActions: z.boolean(),
  digestFrequency: DigestFrequencySchema,
});
export type NotificationPreferencesResponse = z.infer<
  typeof notificationPreferencesResponseSchema
>;

const DESKTOP_LABEL = "Notificações";

export const notificationEndpoints = {
  listRecent: endpoint({
    method: "get",
    path: "/api/notifications",
    query: ListNotificationsQuerySchema,
    response: notificationsListResponseSchema,
    failure: "Failed to fetch notifications",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  getUnreadCount: endpoint({
    method: "get",
    path: "/api/notifications/unread-count",
    response: unreadNotificationsResponseSchema,
    failure: "Failed to fetch unread count",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  markRead: endpoint({
    method: "post",
    path: "/api/notifications/mark-read",
    body: MarkNotificationsReadSchema,
    response: z.object({
      message: z.string(),
      updatedIds: z.array(z.number()),
    }),
    failure: "Failed to mark as read",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  markAllRead: endpoint({
    method: "post",
    path: "/api/notifications/mark-all-read",
    response: z.object({ message: z.string(), count: z.number() }),
    failure: "Failed to mark all as read",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  getPreferences: endpoint({
    method: "get",
    path: "/api/notifications/preferences",
    response: notificationPreferencesResponseSchema,
    failure: "Failed to fetch preferences",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  updatePreferences: endpoint({
    method: "put",
    path: "/api/notifications/preferences",
    body: UpdateNotificationPreferencesSchema,
    response: notificationPreferencesResponseSchema,
    failure: "Failed to update preferences",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
} as const satisfies EndpointGroup;
