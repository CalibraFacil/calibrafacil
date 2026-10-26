/**
 * Post-approval notifications (ISO/IEC 17025 7.10, roadmap 2 B2).
 *
 * The approval transaction writes the regulated records itself (the asset
 * out-of-tolerance event, the asset calibration-date advance and their audit
 * rows) and STAGES these two queue jobs in the same transaction: they exist
 * if and only if the approval committed, and the queue delivers them after the
 * commit with its retries. A handler that throws is retried by the queue.
 */

import { db } from "@calibra-facil/db";
import { forOrg } from "@calibra-facil/db/for-org";
import { assetOotAuditLog, assetOotEvent } from "@calibra-facil/db/schema";
import {
  notifyAssetFoundOutOfTolerance,
  notifyJobApproved,
} from "@calibra-facil/notifications";
import type {
  AssetOotNotificationBackgroundJobMessage as AssetOotNotificationMessage,
  JobApprovedNotificationBackgroundJobMessage as JobApprovedNotificationMessage,
} from "@calibra-facil/schemas";
import { and, eq } from "drizzle-orm";

/** Tell the technician (or the job's creator) the calibration was approved. */
export async function processJobApprovedNotification(
  message: JobApprovedNotificationMessage,
): Promise<void> {
  await notifyJobApproved(message.jobId, message.userId);
}

/**
 * Alert the customer's portal users (in-app + e-mail) about an out-of-tolerance
 * as-found result and record the `notify` audit entry. Idempotent per event: a
 * redelivery after the audit entry exists sends nothing, so a re-approval
 * cycle or a reconciler pass never notifies the customer twice.
 */
export async function processAssetOotNotification(
  message: AssetOotNotificationMessage,
): Promise<void> {
  const lab = forOrg(db, message.organizationId);

  const state = await lab.transaction(async (tx) => {
    const [event] = await tx
      .select({ id: assetOotEvent.id, jobId: assetOotEvent.jobId })
      .from(assetOotEvent)
      .where(eq(assetOotEvent.id, message.eventId))
      .limit(1);
    if (!event) return null;

    const [notified] = await tx
      .select({ id: assetOotAuditLog.id })
      .from(assetOotAuditLog)
      .where(
        and(
          eq(assetOotAuditLog.eventId, event.id),
          eq(assetOotAuditLog.action, "notify"),
        ),
      )
      .limit(1);
    return { jobId: event.jobId, alreadyNotified: notified !== undefined };
  });

  if (!state) {
    // The event is gone (the approval that wrote it was reverted): nothing to say.
    console.warn(
      `[AssetOOT] Event ${message.eventId} no longer exists; its notification is dropped.`,
    );
    return;
  }
  if (state.alreadyNotified) return;

  // A failure throws: the queue retries the job (3 attempts, backoff), so the
  // customer alert is not lost to a transient e-mail or database error.
  await notifyAssetFoundOutOfTolerance(state.jobId);

  await lab.transaction((tx) =>
    tx.insert(assetOotAuditLog).values({
      organizationId: message.organizationId,
      eventId: message.eventId,
      action: "notify",
      performedBy: message.userId,
    }),
  );
}
