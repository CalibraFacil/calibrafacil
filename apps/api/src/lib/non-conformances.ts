import { db } from "@calibra-facil/db";
import {
  nonConformance,
  nonConformanceAuditLog,
  type NonConformanceTriggerSource,
  type NonConformanceType,
} from "@calibra-facil/db/schema";
import { notifyNCCreated } from "@calibra-facil/notifications";
import { and, desc, eq, ilike } from "drizzle-orm";

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
): Promise<string> {
  const year = new Date().getFullYear();
  const [lastNc] = await db
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
 */
export async function createNonConformanceRecord(
  params: CreateNonConformanceRecordParams,
): Promise<typeof nonConformance.$inferSelect> {
  let newNc: typeof nonConformance.$inferSelect | null = null;
  for (let attempt = 0; attempt < MAX_SEQ_RETRIES; attempt++) {
    const ncNumber = await generateNcNumber(params.organizationId);
    try {
      const [inserted] = await db
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
      newNc = inserted ?? null;
      break;
    } catch (err) {
      if (!isUniqueViolation(err) || attempt === MAX_SEQ_RETRIES - 1) throw err;
    }
  }

  if (!newNc) {
    throw new Error("Falha ao criar nao conformidade");
  }

  await db.insert(nonConformanceAuditLog).values({
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

  return newNc;
}
