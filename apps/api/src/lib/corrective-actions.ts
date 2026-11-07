import type { OrgDb } from "@calibra-facil/db/for-org";
import {
  correctiveAction,
  correctiveActionAuditLog,
  type CorrectiveActionCategory,
  type CorrectiveActionSeverity,
  type CorrectiveActionSource,
  type CorrectiveActionType,
  type RootCauseAnalysisMethod,
} from "@calibra-facil/db/schema";
import { and, eq } from "drizzle-orm";
import { notFound } from "./domain-errors";
import { insertWithSequentialNumber } from "./sequential-number";

/**
 * Shared CAPA creator (ISO 17025 §8.7). Single code path for the cloud route
 * (POST /api/capa), the NC escalate-to-capa flow and the §7.7 auto-escalations
 * (unsatisfactory proficiency test, out-of-control SPC chart — issue #60), so
 * every entry point produces the same CAPA number sequence and audit-log entry.
 */

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
 *
 * `o` is the org-bound transaction the record is written in: the number, the
 * CAPA and its audit entry run under the organization the caller named for
 * row-level security and commit with the caller's other writes.
 */
export async function createCorrectiveActionRecord(
  params: CreateCorrectiveActionRecordParams,
  o: OrgDb,
): Promise<typeof correctiveAction.$inferSelect> {
  const newCapa = await insertWithSequentialNumber(o, {
    table: correctiveAction,
    organizationColumn: correctiveAction.organizationId,
    numberColumn: correctiveAction.capaNumber,
    prefix: "CAPA",
    insert: (tx, capaNumber) =>
      tx
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
        .returning(),
  });

  await o.insert(correctiveActionAuditLog).values({
    organizationId: params.organizationId,
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

/**
 * The laboratory's CAPA with this id. Throws 404 when no CAPA of this laboratory
 * matches.
 */
export async function requireLabCapa(
  o: OrgDb,
  id: number,
): Promise<typeof correctiveAction.$inferSelect> {
  const [found] = await o
    .select()
    .from(correctiveAction)
    .where(
      and(
        eq(correctiveAction.id, id),
        eq(correctiveAction.organizationId, o.organizationId),
      ),
    )
    .limit(1);
  if (!found) throw notFound("capa_not_found", "CAPA nao encontrada");
  return found;
}
