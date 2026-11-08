// Notifications, one door: `notify(type, payload)` runs the type's recipe
// (recipes/*.ts: entity reads, recipients, in-app copy, e-mail context) and
// hands each yielded row to `sendNotification` (delivery.ts: preferences,
// in-app row, e-mail). Every caller (API, worker, jobs-core) calls `notify`.
import type { NotificationType } from "@calibra-facil/schemas";
import { sendNotification } from "./delivery";
import { NOTIFICATION_RECIPES, type NotificationPayloads } from "./recipes";

export {
  getLabEmailBrand,
  getRecipientsByRole,
  sendNotification,
  type NotificationResult,
  type SendNotificationOptions,
} from "./delivery";
export {
  sendPortalDueDigests,
  type PortalDigestRunResult,
} from "./portal-digest";
export type { NotificationPayloads } from "./recipes";

/** Send the notification of `type` to everyone its recipe resolves. */
export async function notify<T extends NotificationType>(
  type: T,
  payload: NotificationPayloads[T],
): Promise<void> {
  for await (const row of NOTIFICATION_RECIPES[type](payload)) {
    await sendNotification(row);
  }
}
