import type { OrgDb } from "@calibra-facil/db/for-org";
import {
  nonConformance,
  type NonConformanceTriggerSource,
  type NonConformanceType,
} from "@calibra-facil/db/schema";
import { notify } from "@calibra-facil/notifications";
import { and, eq } from "drizzle-orm";
import { notFound } from "../../lib/domain-errors";
import type { OrgContext } from "../../lib/org-context";
import { insertWithSequentialNumber } from "./sequential-number";

/**
 * Shared non-conformance creator (ISO 17025 §8.7 / §7.10). Single code path
 * for the cloud route (POST /api/nc), the out-of-tolerance flag flow and the
 * desktop sync ingest, so every entry point produces the same NC number
 * sequence, audit-log entry and admin/owner notification.
 */

/**
 * What the creator needs of a write context: the org-bound handle, the actor
 * the audit row is recorded against, and where the notification waits for the
 * commit. A full `OrgContext` fits.
 */
export type NonConformanceWriteContext = Pick<
  OrgContext,
  "org" | "actor" | "o" | "audit" | "afterCommit"
>;

export type CreateNonConformanceRecordParams = {
  type: NonConformanceType;
  description: string;
  detectedAt: Date;
  jobId?: number | null;
  triggerSource?: NonConformanceTriggerSource | null;
  /** Payload recorded in the audit-log "create" entry. */
  auditChanges?: Record<string, unknown>;
};

/**
 * Creates the NC (with the retry loop over the sequential-number unique
 * constraint), writes the audit-log entry and registers the admin/owner
 * notification to run once the context's transaction has committed. Throws
 * when the insert cannot be completed.
 */
export async function createNonConformanceRecord(
  params: CreateNonConformanceRecordParams,
  ctx: NonConformanceWriteContext,
): Promise<typeof nonConformance.$inferSelect> {
  const newNc = await insertWithSequentialNumber(ctx.o, {
    table: nonConformance,
    organizationColumn: nonConformance.organizationId,
    numberColumn: nonConformance.ncNumber,
    prefix: "NC",
    insert: (tx, ncNumber) =>
      tx
        .insert(nonConformance)
        .values({
          ncNumber,
          organizationId: ctx.org,
          jobId: params.jobId ?? null,
          type: params.type,
          triggerSource: params.triggerSource ?? null,
          description: params.description,
          detectedBy: ctx.actor.userId,
          detectedAt: params.detectedAt,
          status: "open",
          createdBy: ctx.actor.userId,
        })
        .returning(),
  });

  await ctx.audit("nonConformance", newNc.id, {
    action: "create",
    changes: params.auditChanges ?? {
      initial: {
        type: params.type,
        triggerSource: params.triggerSource ?? null,
        jobId: params.jobId ?? null,
      },
    },
  });

  // The notification reads the NC back: it waits for the commit and never
  // runs on a rolled-back record.
  ctx.afterCommit(() =>
    notify("NC_CREATED", {
      ncId: newNc.id,
      ncNumber: newNc.ncNumber,
      ncType: newNc.type,
      description: newNc.description,
      organizationId: ctx.org,
      createdByUserId: ctx.actor.userId,
    }),
  );

  return newNc;
}

/**
 * The laboratory's non-conformance with this id. Throws 404 when no NC of this
 * laboratory matches.
 */
export async function requireLabNonConformance(
  o: OrgDb,
  id: number,
): Promise<typeof nonConformance.$inferSelect> {
  const [found] = await o
    .select()
    .from(nonConformance)
    .where(
      and(
        eq(nonConformance.id, id),
        eq(nonConformance.organizationId, o.organizationId),
      ),
    )
    .limit(1);
  if (!found) {
    throw notFound(
      "non_conformance_not_found",
      "Nao conformidade nao encontrada",
    );
  }
  return found;
}
