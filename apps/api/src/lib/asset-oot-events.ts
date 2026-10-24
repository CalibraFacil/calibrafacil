import { assetOotEvent, assetOotAuditLog } from "@calibra-facil/db/schema";
import { notifyAssetFoundOutOfTolerance } from "@calibra-facil/notifications";
import { orgDb } from "./org-db";

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
  const lab = orgDb(params.labOrganizationId);

  // The event and its first audit entry commit together (one transaction that
  // names the laboratory, row-level security). The customer notification reads
  // the committed event, so it runs after, and its audit entry is its own.
  const inserted = await lab.transaction(async (o) => {
    const [row] = await o
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
    if (!row) return null;

    await o.insert(assetOotAuditLog).values({
      organizationId: params.labOrganizationId,
      eventId: row.id,
      action: "create",
      changes: {
        jobId: params.jobId,
        assetId: params.assetId,
        detectedAt: params.detectedAt.toISOString(),
      },
      performedBy: params.actorUserId,
    });
    return row;
  });

  // Double-approval (re-approval after rejection cycles) must not duplicate
  // the event or re-notify the customer.
  if (!inserted) {
    return { eventId: null, created: false };
  }

  // Customer notification (in-app row + lab-branded email); failure to send
  // must not undo the event.
  try {
    await notifyAssetFoundOutOfTolerance(params.jobId);
    await lab.transaction((o) =>
      o.insert(assetOotAuditLog).values({
        organizationId: params.labOrganizationId,
        eventId: inserted.id,
        action: "notify",
        performedBy: params.actorUserId,
      }),
    );
  } catch (error) {
    console.error(
      `[AssetOOT] Failed to notify customer for event ${inserted.id}:`,
      error,
    );
  }

  return { eventId: inserted.id, created: true };
}
