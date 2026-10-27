import type { OrgDb } from "@calibra-facil/db/for-org";
import { assetOotEvent, assetOotAuditLog } from "@calibra-facil/db/schema";
import { and, eq } from "drizzle-orm";

/**
 * Asset OOT event (#740 Track B, ISO/IEC 17025 7.10). When a job is approved
 * with a NON_CONFORMING as-found verdict, the customer-facing event and its
 * first audit entry are written INSIDE the approval's own transaction (roadmap
 * 2 B2): an approval cannot commit without the event, and the event cannot
 * exist without the approval. "Never lost, never without audit" (decision Q39)
 * is therefore met by atomicity, not by retries.
 *
 * The customer alert (in-app + e-mail) is not a database write: it is staged
 * as an `ASSET_OOT_NOTIFICATION` queue job in the same transaction and
 * delivered after the commit (packages/jobs-core, `approval-notifications.ts`).
 */

export type AssetOotEventInput = {
  jobId: number;
  assetId: number;
  customerId: number;
  labOrganizationId: string;
  detectedAt: Date;
  actorUserId: string;
  /**
   * Set by the nightly reconciler when it writes an event the approval did not
   * (an approval that predates the transactional write, or one that crashed
   * before it): the audit entry says so.
   */
  reconciled?: boolean;
  /**
   * The decision rule the as-found non-conformity was judged by (roadmap 2 C4;
   * "undeclared": the method declares none, judged by simple acceptance).
   * Recorded on the audit entry with the event.
   */
  decisionRule?: string;
};

/**
 * Insert the event and its `create` audit entry on `o` (the caller's
 * transaction). Idempotent per job (the `job_id` unique key): a second call for
 * the same job writes nothing and returns null, so a re-approval after a
 * rejection cycle neither duplicates the event nor re-notifies the customer.
 * Any failure throws, which rolls the caller's transaction back.
 */
export async function recordAssetOotEvent(
  o: OrgDb,
  params: AssetOotEventInput,
): Promise<{ eventId: number } | null> {
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
    .returning({ id: assetOotEvent.id });
  if (!row) return null;

  await o.insert(assetOotAuditLog).values({
    organizationId: params.labOrganizationId,
    eventId: row.id,
    action: "create",
    changes: {
      jobId: params.jobId,
      assetId: params.assetId,
      detectedAt: params.detectedAt.toISOString(),
      ...(params.decisionRule ? { decisionRule: params.decisionRule } : {}),
      ...(params.reconciled
        ? { reconciled: true, source: "approval-effects-reconciler" }
        : {}),
    },
    performedBy: params.actorUserId,
  });
  return { eventId: row.id };
}

/**
 * Undo `recordAssetOotEvent` for an approval that is being reverted before it
 * was released (the certificate job could not be dispatched, in-process
 * dispatch only): the job returns to REVIEW, so the customer-facing event must
 * not outlive it. The audit trail is append-only and keeps the `create` entry;
 * a `withdraw` entry says why the event is gone.
 */
export async function withdrawAssetOotEvent(
  o: OrgDb,
  params: {
    eventId: number;
    jobId: number;
    labOrganizationId: string;
    actorUserId: string;
    reason: string;
  },
): Promise<void> {
  const deleted = await o
    .delete(assetOotEvent)
    .where(
      and(
        eq(assetOotEvent.id, params.eventId),
        eq(assetOotEvent.jobId, params.jobId),
      ),
    )
    .returning({ id: assetOotEvent.id });
  if (deleted.length === 0) return;

  await o.insert(assetOotAuditLog).values({
    organizationId: params.labOrganizationId,
    eventId: params.eventId,
    action: "withdraw",
    changes: { jobId: params.jobId, reason: params.reason },
    performedBy: params.actorUserId,
  });
}
