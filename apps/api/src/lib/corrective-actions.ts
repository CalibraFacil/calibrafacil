import { db } from "@calibra-facil/db";
import {
  correctiveAction,
  correctiveActionAuditLog,
  type CorrectiveActionCategory,
  type CorrectiveActionSeverity,
  type CorrectiveActionSource,
  type CorrectiveActionType,
  type RootCauseAnalysisMethod,
} from "@calibra-facil/db/schema";
import { and, desc, eq, ilike } from "drizzle-orm";

/**
 * Shared CAPA creator (ISO 17025 §8.7). Single code path for the cloud route
 * (POST /api/capa), the NC escalate-to-capa flow and the §7.7 auto-escalations
 * (unsatisfactory proficiency test, out-of-control SPC chart — issue #60), so
 * every entry point produces the same CAPA number sequence and audit-log entry.
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

export async function generateCapaNumber(
  organizationId: string,
): Promise<string> {
  const year = new Date().getFullYear();
  const [lastCapa] = await db
    .select({ capaNumber: correctiveAction.capaNumber })
    .from(correctiveAction)
    .where(
      and(
        eq(correctiveAction.organizationId, organizationId),
        ilike(correctiveAction.capaNumber, `CAPA-${year}-%`),
      ),
    )
    .orderBy(desc(correctiveAction.capaNumber))
    .limit(1);

  let nextSeq = 1;
  if (lastCapa) {
    const parts = lastCapa.capaNumber.split("-");
    nextSeq = parseInt(parts[2] ?? "0", 10) + 1;
  }
  return `CAPA-${year}-${String(nextSeq).padStart(4, "0")}`;
}

export type CreateCorrectiveActionRecordParams = {
  organizationId: string;
  actorUserId: string;
  source: CorrectiveActionSource;
  sourceReference?: string | null;
  title: string;
  description: string;
  detectionDate?: Date | null;
  type?: CorrectiveActionType;
  severity?: CorrectiveActionSeverity;
  category?: CorrectiveActionCategory;
  rootCauseAnalysis?: string | null;
  rootCauseAnalysisMethod?: RootCauseAnalysisMethod | null;
  actionPlan?: string | null;
  preventiveMeasures?: string | null;
  responsibleId?: string | null;
  dueDate?: Date | null;
  ipAddress?: string | null;
  /** Payload recorded in the audit-log "create" entry. */
  auditChanges?: Record<string, unknown>;
};

/**
 * Creates the CAPA (with the retry loop over the sequential-number unique
 * constraint) and writes the audit-log entry. Throws when the insert cannot
 * be completed. Notifications stay with the callers — the plain CAPA create
 * route intentionally dispatches none.
 */
export async function createCorrectiveActionRecord(
  params: CreateCorrectiveActionRecordParams,
): Promise<typeof correctiveAction.$inferSelect> {
  let newCapa: typeof correctiveAction.$inferSelect | null = null;
  for (let attempt = 0; attempt < MAX_SEQ_RETRIES; attempt++) {
    const capaNumber = await generateCapaNumber(params.organizationId);
    try {
      const [inserted] = await db
        .insert(correctiveAction)
        .values({
          capaNumber,
          organizationId: params.organizationId,
          source: params.source,
          sourceReference: params.sourceReference ?? null,
          title: params.title,
          description: params.description,
          detectionDate: params.detectionDate ?? null,
          type: params.type ?? "corrective",
          severity: params.severity ?? "minor",
          category: params.category ?? "procedure",
          rootCauseAnalysis: params.rootCauseAnalysis ?? null,
          rootCauseAnalysisMethod: params.rootCauseAnalysisMethod ?? null,
          actionPlan: params.actionPlan ?? null,
          preventiveMeasures: params.preventiveMeasures ?? null,
          responsibleId: params.responsibleId ?? null,
          dueDate: params.dueDate ?? null,
          status: "OPEN",
          createdBy: params.actorUserId,
        })
        .returning();
      newCapa = inserted ?? null;
      break;
    } catch (err) {
      if (!isUniqueViolation(err) || attempt === MAX_SEQ_RETRIES - 1) throw err;
    }
  }

  if (!newCapa) {
    throw new Error("Falha ao criar CAPA");
  }

  await db.insert(correctiveActionAuditLog).values({
    capaId: newCapa.id,
    action: "create",
    changes: params.auditChanges ?? {
      initial: {
        source: params.source,
        sourceReference: params.sourceReference ?? null,
      },
    },
    performedBy: params.actorUserId,
    ipAddress: params.ipAddress ?? null,
  });

  return newCapa;
}
