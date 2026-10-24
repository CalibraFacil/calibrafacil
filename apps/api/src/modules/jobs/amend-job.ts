import { appendJobEvent } from "@calibra-facil/db/job-events";
import { calibrationJob, type JobStatus } from "@calibra-facil/db/schema";
import {
  allowedFrom,
  requireTargetOf,
  targetOf,
} from "@calibra-facil/schemas/job-transitions";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { generateCertificateIdentity } from "../../lib/certificate-numbering";
import { invalid, type DomainError } from "../../lib/domain-errors";
import { orgTransactionWithExecutor } from "../../lib/org-transaction";
import { buildUnitScopeCondition } from "../../lib/units";
import {
  jobActorAuditFields,
  type JobLifecycleActor,
  type JobRow,
  type UnitScope,
} from "./job-actor";
import { JobStatusConflictError } from "./job-status-transitions";

/**
 * Amend an approved certificate (ISO/IEC 17025:2017 §7.8.4.1): the original
 * job becomes SUPERSEDED and a DRAFT clone, with its own certificate number,
 * takes over for the corrections. The ONE implementation behind the cloud
 * route.
 *
 * Everything runs in one transaction serialised on the original job's row
 * (`FOR UPDATE`): the status and already-amended checks are re-evaluated under
 * the lock, so two concurrent amendments can never both pass them (no
 * duplicate DRAFT amendment, no burned certificate number). The certificate
 * number is reserved on the same transaction, so a refusal rolls it back too.
 *
 *   1. load the job under the lock (organization + unit scope)
 *   2. the transition table (`amend`): APPROVED only
 *   3. not already superseded
 *   4. the clone, the compare-and-set on APPROVED and both audit rows
 *
 * A refusal writes nothing. Enqueueing the original's watermarked PDF and
 * notifying the customer are the caller's, after the commit.
 */
export type AmendJobCommand = {
  actor: JobLifecycleActor;
  jobId: number;
  organizationId: string;
  /** The units the caller may act in; `null` is organization-wide. */
  unitScope: UnitScope | null;
  /** The written reason, kept on both jobs and in the audit trail. */
  reason: string;
};

export type AmendJobResult =
  | {
      status: "ok";
      originalJob: JobRow;
      amendedJob: JobRow;
      amendmentNumber: number;
    }
  | { status: "not_found" }
  | {
      status: "illegal_transition";
      currentStatus: JobStatus;
      error: DomainError;
    }
  | { status: "already_amended"; supersededById: number; error: DomainError }
  /** The job left the status it was judged in under the lock; nothing written. */
  | { status: "concurrent_update" };

export async function amendJob(
  command: AmendJobCommand,
): Promise<AmendJobResult> {
  const { actor, organizationId } = command;

  // The transaction names the laboratory (row-level security). It hands the
  // raw executor on purpose: the certificate numbering runs raw SQL (advisory
  // lock). Every statement below carries the organization predicate itself.
  return orgTransactionWithExecutor(
    organizationId,
    async (_o, tx): Promise<AmendJobResult> => {
      const [originalJob] = await tx
        .select()
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.id, command.jobId),
            eq(calibrationJob.organizationId, organizationId),
            command.unitScope
              ? buildUnitScopeCondition(
                  calibrationJob.unitId,
                  command.unitScope,
                )
              : undefined,
          ),
        )
        .limit(1)
        .for("update");
      if (!originalJob) return { status: "not_found" };

      if (targetOf(originalJob.status, "amend") === null) {
        return {
          status: "illegal_transition",
          currentStatus: originalJob.status,
          error: invalid(
            "job_not_amendable",
            `Apenas certificados aprovados podem ser retificados. Status atual: ${originalJob.status}`,
          ),
        };
      }

      if (originalJob.supersededById) {
        return {
          status: "already_amended",
          supersededById: originalJob.supersededById,
          error: invalid(
            "job_already_amended",
            "Este certificado ja foi retificado",
            { legacyBody: { supersededBy: originalJob.supersededById } },
          ),
        };
      }

      // This is already an amendment: increment.
      const amendmentNumber = originalJob.supersedesId
        ? (originalJob.amendmentNumber || 0) + 1
        : 1;

      // A lab-specific certificate number for the amended job.
      const certificateIdentity = await generateCertificateIdentity(
        {
          organizationId,
          generatedAt: new Date(),
          performedBy: actor.userId,
        },
        tx,
      );
      const [amendedJob] = await tx
        .insert(calibrationJob)
        .values({
          jobId: certificateIdentity.certificateNumber,
          certificateName: certificateIdentity.certificateName,
          certificateNumberingSnapshot: certificateIdentity.snapshot,
          organizationId: originalJob.organizationId,
          unitId: originalJob.unitId,
          customerId: originalJob.customerId,
          assetId: originalJob.assetId,
          serviceId: originalJob.serviceId,
          technicianId: originalJob.technicianId,
          methodSnapshot: originalJob.methodSnapshot,
          standardsSnapshot: originalJob.standardsSnapshot,
          // Carried forward verbatim as a historical record of what the
          // superseded certificate rendered from. Nothing resolves it any
          // more: the amendment cannot be approved until the fixed layouts
          // land (#865), and it will render with whatever layout is current
          // then, not with the original's XLSX template.
          certificateTemplateSnapshot: originalJob.certificateTemplateSnapshot,
          status: requireTargetOf(null, "create"), // DRAFT, for the corrections
          dueDate: originalJob.dueDate,
          data: originalJob.data, // Clone calibration data
          results: originalJob.results, // Clone results
          supersedesId: originalJob.id, // Link to the original
          amendmentNumber,
          amendmentReason: command.reason,
          createdBy: actor.userId,
        })
        .returning();
      if (!amendedJob) {
        throw new Error("Falha ao criar retificacao");
      }

      // The original becomes SUPERSEDED (compare-and-set on APPROVED); the
      // reason is stored on it too so it shows when viewing the superseded
      // certificate.
      const supersededStatus = requireTargetOf(originalJob.status, "amend");
      const [superseded] = await tx
        .update(calibrationJob)
        .set({
          status: supersededStatus,
          supersededById: amendedJob.id,
          supersededAt: new Date(),
          amendmentReason: command.reason,
        })
        .where(
          and(
            eq(calibrationJob.id, originalJob.id),
            eq(calibrationJob.organizationId, organizationId),
            inArray(calibrationJob.status, allowedFrom("amend")),
            isNull(calibrationJob.supersededById),
          ),
        )
        .returning();
      if (!superseded) {
        // Rolls back the amended job and the reserved certificate number.
        throw new JobStatusConflictError();
      }

      await appendJobEvent(tx, {
        action: "supersede",
        organizationId,
        jobId: originalJob.id,
        actor: { kind: "user", userId: actor.userId },
        changes: {
          ...jobActorAuditFields(actor),
          status: { old: originalJob.status, new: supersededStatus },
          supersededById: amendedJob.id,
        },
        ipAddress: actor.ipAddress ?? null,
        reason: `Certificado retificado. Novo: ${amendedJob.jobId}. Motivo: ${command.reason}`,
      });

      await appendJobEvent(tx, {
        action: "create_amendment",
        organizationId,
        jobId: amendedJob.id,
        actor: { kind: "user", userId: actor.userId },
        changes: {
          ...jobActorAuditFields(actor),
          supersedesId: originalJob.id,
          amendmentNumber,
          reason: command.reason,
        },
        ipAddress: actor.ipAddress ?? null,
        reason: command.reason,
      });

      return { status: "ok", originalJob, amendedJob, amendmentNumber };
    },
  ).catch((error: unknown) => {
    if (error instanceof JobStatusConflictError) {
      return { status: "concurrent_update" } satisfies AmendJobResult;
    }
    throw error;
  });
}
