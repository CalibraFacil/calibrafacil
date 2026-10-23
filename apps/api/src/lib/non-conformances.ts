import { afterTransactionCommit, db } from "@calibra-facil/db";
import type { OrgExecutor } from "@calibra-facil/db/for-org";
import {
  nonConformance,
  nonConformanceAuditLog,
  type NonConformanceTriggerSource,
  type NonConformanceType,
} from "@calibra-facil/db/schema";
import { notifyNCCreated } from "@calibra-facil/notifications";
import { and, desc, eq, ilike } from "drizzle-orm";
import type { OrgScope } from "./after-commit";

/**
 * Shared non-conformance creator (ISO 17025 §8.7 / §7.10). Single code path
 * for the cloud route (POST /api/nc), the out-of-tolerance flag flow and the
 * desktop sync ingest, so every entry point produces the same NC number
 * sequence, audit-log entry and admin/owner notification.
 */

const MAX_SEQ_RETRIES = 3;

export function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.message.includes("unique") ||
      err.message.includes("duplicate") ||
      err.message.includes("23505"))
  );
}

export async function generateNcNumber(
  organizationId: string,
  executor: Pick<OrgExecutor, "select"> = db,
): Promise<string> {
  const year = new Date().getFullYear();
  const [lastNc] = await executor
    .select({ ncNumber: nonConformance.ncNumber })
    .from(nonConformance)
    .where(
      and(
        eq(nonConformance.organizationId, organizationId),
        ilike(nonConformance.ncNumber, `NC-${year}-%`),
      ),
    )
    .orderBy(desc(nonConformance.ncNumber))
    .limit(1);

  let nextSeq = 1;
  if (lastNc) {
    const parts = lastNc.ncNumber.split("-");
    nextSeq = parseInt(parts[2] ?? "0", 10) + 1;
  }
  return `NC-${year}-${String(nextSeq).padStart(4, "0")}`;
}

export type CreateNonConformanceRecordParams = {
  organizationId: string;
  actorUserId: string;
  type: NonConformanceType;
  description: string;
  detectedAt: Date;
  jobId?: number | null;
  triggerSource?: NonConformanceTriggerSource | null;
  ipAddress?: string | null;
  /** Payload recorded in the audit-log "create" entry. */
  auditChanges?: Record<string, unknown>;
};

/**
 * Creates the NC (with the retry loop over the sequential-number unique
 * constraint), writes the audit-log entry and fires the admin/owner
 * notification. Throws when the insert cannot be completed.
 *
 * `scope` joins the caller's org-bound transaction
 * (`orgDb(org).transaction((tx) => ...)`): the number, the NC and its audit
 * entry are written in it, under the organization the caller named for
 * row-level security, and the notification is handed to `scope.afterCommit`
 * for the caller to run once the transaction has committed. Without it the NC
 * is written through the plain `db` and the notification waits for the
 * surrounding transaction scope, if any, as before.
 */
export async function createNonConformanceRecord(
  params: CreateNonConformanceRecordParams,
  scope?: OrgScope,
): Promise<typeof nonConformance.$inferSelect> {
  let newNc: typeof nonConformance.$inferSelect | null = null;
  const writer: Pick<OrgExecutor, "select" | "insert"> = scope?.executor ?? db;
  const insertNc = (target: Pick<OrgExecutor, "insert">, ncNumber: string) =>
    target
      .insert(nonConformance)
      .values({
        ncNumber,
        organizationId: params.organizationId,
        jobId: params.jobId ?? null,
        type: params.type,
        triggerSource: params.triggerSource ?? null,
        description: params.description,
        detectedBy: params.actorUserId,
        detectedAt: params.detectedAt,
        status: "open",
        createdBy: params.actorUserId,
      })
      .returning();
  for (let attempt = 0; attempt < MAX_SEQ_RETRIES; attempt++) {
    const ncNumber = await generateNcNumber(params.organizationId, writer);
    try {
      // Its own transaction (a savepoint when the caller already runs in one,
      // as the desktop sync apply does): a unique violation on the sequential
      // number aborts a Postgres transaction, and the retry below would fail
      // with it unless only this attempt is rolled back.
      const [inserted] = scope
        ? await scope.executor.transaction((tx) => insertNc(tx, ncNumber))
        : await db.transaction((tx) => insertNc(tx, ncNumber));
      newNc = inserted ?? null;
      break;
    } catch (err) {
      if (!isUniqueViolation(err) || attempt === MAX_SEQ_RETRIES - 1) throw err;
    }
  }

  if (!newNc) {
    throw new Error("Falha ao criar nao conformidade");
  }

  await writer.insert(nonConformanceAuditLog).values({
    organizationId: params.organizationId,
    ncId: newNc.id,
    action: "create",
    changes: params.auditChanges ?? {
      initial: {
        type: params.type,
        triggerSource: params.triggerSource ?? null,
        jobId: params.jobId ?? null,
      },
    },
    performedBy: params.actorUserId,
    ipAddress: params.ipAddress ?? null,
  });

  // After the surrounding transaction commits, when there is one: the
  // notification reads the NC back, and must not run on a rolled-back record.
  const notify = () =>
    notifyNCCreated(
      newNc.id,
      newNc.ncNumber,
      newNc.type,
      newNc.description,
      params.organizationId,
      params.actorUserId,
    ).catch((err) =>
      console.error("[NC] Failed to send NC-created notification:", err),
    );
  if (scope) scope.afterCommit(notify);
  else afterTransactionCommit(notify);

  return newNc;
}
