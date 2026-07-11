import { db } from "@calibra-facil/db";
import { assetOotEvent, assetOotAuditLog } from "@calibra-facil/db/schema";
import { notifyAssetFoundOutOfTolerance } from "@calibra-facil/notifications";

/**
 * Asset OOT event creation (#740 Track B). Called fire-and-forget from the
 * job-approval flow when the as-found verdict is NON_CONFORMING: creates the
 * customer-facing event (idempotent per job via the jobId unique constraint)
 * and alerts the customer's portal users. Never blocks or fails the approval.
 */
export async function createAssetOotEventForApprovedJob(params: {
  jobId: number;
  assetId: number;
  customerId: number;
  labOrganizationId: string;
  detectedAt: Date;
  actorUserId: string;
}): Promise<{ eventId: number | null; created: boolean }> {
  const [inserted] = await db
    .insert(assetOotEvent)
    .values({
      jobId: params.jobId,
      assetId: params.assetId,
      customerId: params.customerId,
      labOrganizationId: params.labOrganizationId,
      status: "OPEN",
      detectedAt: params.detectedAt,
    })
    .onConflictDoNothing({ target: assetOotEvent.jobId })
    .returning();

  // Double-approval (re-approval after rejection cycles) must not duplicate
  // the event or re-notify the customer.
  if (!inserted) {
    return { eventId: null, created: false };
  }

  await db.insert(assetOotAuditLog).values({
    eventId: inserted.id,
    action: "create",
    changes: {
      jobId: params.jobId,
      assetId: params.assetId,
      detectedAt: params.detectedAt.toISOString(),
    },
    performedBy: params.actorUserId,
  });

  // Customer notification (in-app row + lab-branded email); failure to send
  // must not undo the event.
  try {
    await notifyAssetFoundOutOfTolerance(params.jobId);
    await db.insert(assetOotAuditLog).values({
      eventId: inserted.id,
      action: "notify",
      performedBy: params.actorUserId,
    });
  } catch (error) {
    console.error(
      `[AssetOOT] Failed to notify customer for event ${inserted.id}:`,
      error,
    );
  }

  return { eventId: inserted.id, created: true };
}
