import { appendJobEvent } from "@calibra-facil/db/job-events";
import { calibrationJob, type JobStatus } from "@calibra-facil/db/schema";
import {
  requireTargetOf,
  targetOf,
} from "@calibra-facil/schemas/job-transitions";
import { and, eq, ne } from "drizzle-orm";
import { generateCertificateIdentity } from "../../lib/certificate-numbering";
import { loadCertificateLifecycles } from "../../lib/certificate-lifecycle";
import { conflict, invalid, type DomainError } from "../../lib/domain-errors";
import { orgTransactionWithExecutor } from "../../lib/org-transaction";
import { buildUnitScopeCondition } from "../../lib/units";
import {
  jobActorAuditFields,
  type JobLifecycleActor,
  type JobRow,
  type UnitScope,
} from "./job-actor";

/**
 * The technical record an amendment carries over from the certificate it
 * corrects (ISO/IEC 17025:2017 §7.8.8): every field of the original job row that
 * its frozen `certificate_input` was built from. An amendment changes only what
 * the user edits; nothing is re-derived "as of today".
 *
 * - `performedAt` stays the original's, so the reference standards are judged on
 *   the day the work was done (the submit takes the date from the request, and
 *   the form pre-fills this one), not on the day of the amendment.
 * - `assetSnapshot` is the asset AS CALIBRATED, not a rebuild from the asset row
 *   as it is now.
 * - environment, calibration location, phases and method deviations are part of
 *   what the certificate states (§7.8.2.1) and would otherwise be re-entered.
 *
 * Deliberately NOT carried: the status and approval/rejection fields (the clone
 * walks the workflow itself), the scope verdict and override (re-stamped at
 * submit and approval from the scope as it is then), the as-found verdict
 * (derived at approval), the certificate, label and signature (new document),
 * the verification token, the visit and repair-order links (those belong to the
 * original's business context).
 */
export function technicalRecordOf(original: JobRow) {
  return {
    customerId: original.customerId,
    assetId: original.assetId,
    serviceId: original.serviceId,
    technicianId: original.technicianId,
    dueDate: original.dueDate,
    performedAt: original.performedAt,
    methodSnapshot: original.methodSnapshot,
    assetSnapshot: original.assetSnapshot,
    standardsSnapshot: original.standardsSnapshot,
    environmentalSnapshot: original.environmentalSnapshot,
    calibrationLocationSnapshot: original.calibrationLocationSnapshot,
    calibrationPhaseSnapshot: original.calibrationPhaseSnapshot,
    methodDeviations: original.methodDeviations,
    data: original.data,
    results: original.results,
    // Carried forward verbatim as a historical record of what the
    // superseded certificate rendered from. Nothing resolves it any
    // more: the amendment cannot be approved until the fixed layouts
    // land (#865), and it will render with whatever layout is current
    // then, not with the original's XLSX template.
    certificateTemplateSnapshot: original.certificateTemplateSnapshot,
  } satisfies Partial<typeof calibrationJob.$inferInsert>;
}

/**
 * Amend an approved certificate (ISO/IEC 17025:2017 §7.8.8): a DRAFT clone, with
 * its own certificate number, takes over for the corrections. The ONE
 * implementation behind the cloud route.
 *
 * The ORIGINAL STAYS APPROVED, and so stays the valid certificate, while the
 * amendment is worked on: cancelling the draft, a rejection or a render failure
 * must never leave the customer without a valid certificate. It becomes
 * SUPERSEDED only in the transaction in which the replacement's certificate is
 * issued (the worker's issuance, `issueSupersession` in `@calibra-facil/jobs-core`),
 * atomically, together with its SUPERSEDED status event.
 *
 * "Amendment in progress" is the clone itself: a job whose `supersedes_id` is the
 * original and that is not CANCELED (a partial unique index, migration 0130, makes
 * it one per original).
 *
 * Everything runs in one transaction serialised on the original job's row
 * (`FOR UPDATE`): the status, withdrawal and in-progress checks are re-evaluated
 * under the lock, so two concurrent amendments can never both pass them (no
 * duplicate DRAFT amendment, no burned certificate number). The certificate
 * number is reserved on the same transaction, so a refusal rolls it back too.
 *
 *   1. load the job under the lock (organization + unit scope)
 *   2. the transition table (`amend`): APPROVED only
 *   3. not already superseded, its certificate not withdrawn
 *   4. no other amendment in progress
 *   5. the clone of the whole technical record and both audit rows
 *
 * A refusal writes nothing. Notifying the customer waits for the issuance.
 */
export type AmendJobCommand = {
  actor: JobLifecycleActor;
  jobId: number;
  organizationId: string;
  /** The units the caller may act in; `null` is organization-wide. */
  unitScope: UnitScope | null;
  /** The written reason, kept on the amendment and in the audit trail. */
  reason: string;
};

export type AmendJobResult =
  | {
      status: "ok";
      /** Unchanged: still APPROVED, still the valid certificate. */
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
  /** Another amendment of this certificate is still open (not cancelled). */
  | {
      status: "amendment_in_progress";
      amendedJobId: number;
      error: DomainError;
    }
  | { status: "certificate_withdrawn"; error: DomainError };

export async function amendJob(
  command: AmendJobCommand,
): Promise<AmendJobResult> {
  const { actor, organizationId } = command;

  // The transaction names the laboratory (row-level security). It hands the
  // raw executor on purpose: the certificate numbering runs raw SQL (advisory
  // lock). Every statement below carries the organization predicate itself.
  return orgTransactionWithExecutor(
    organizationId,
    async (o, tx): Promise<AmendJobResult> => {
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

      // A withdrawn certificate is not the one an amendment replaces.
      const lifecycles = await loadCertificateLifecycles(o, [originalJob]);
      if (lifecycles.get(originalJob.id)?.status === "WITHDRAWN") {
        return {
          status: "certificate_withdrawn",
          error: conflict(
            "job_certificate_withdrawn",
            "Este certificado foi retirado e nao pode ser retificado",
          ),
        };
      }

      // One amendment in progress per certificate. The original row lock above
      // serialises two requests; the partial unique index is the last wall.
      const [inProgress] = await tx
        .select({
          id: calibrationJob.id,
          jobId: calibrationJob.jobId,
          status: calibrationJob.status,
        })
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.supersedesId, originalJob.id),
            eq(calibrationJob.organizationId, organizationId),
            ne(calibrationJob.status, "CANCELED"),
          ),
        )
        .limit(1);
      if (inProgress) {
        return {
          status: "amendment_in_progress",
          amendedJobId: inProgress.id,
          error: conflict(
            "job_amendment_in_progress",
            `Ja existe uma retificacao em andamento para este certificado (${inProgress.jobId}). Conclua ou cancele essa retificacao antes de iniciar outra.`,
            {
              details: {
                amendedJobId: inProgress.id,
                amendedJobNumber: inProgress.jobId,
                amendedJobStatus: inProgress.status,
              },
            },
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
          ...technicalRecordOf(originalJob),
          jobId: certificateIdentity.certificateNumber,
          certificateName: certificateIdentity.certificateName,
          certificateNumberingSnapshot: certificateIdentity.snapshot,
          organizationId: originalJob.organizationId,
          unitId: originalJob.unitId,
          status: requireTargetOf(null, "create"), // DRAFT, for the corrections
          supersedesId: originalJob.id, // Link to the original
          amendmentNumber,
          amendmentReason: command.reason,
          createdBy: actor.userId,
        })
        .returning();
      if (!amendedJob) {
        throw new Error("Falha ao criar retificacao");
      }

      await appendJobEvent(tx, {
        action: "amendment_started",
        organizationId,
        jobId: originalJob.id,
        actor: { kind: "user", userId: actor.userId },
        changes: {
          ...jobActorAuditFields(actor),
          amendedJobId: amendedJob.id,
          amendmentNumber,
          reason: command.reason,
        },
        ipAddress: actor.ipAddress ?? null,
        reason: `Retificacao iniciada. Nova: ${amendedJob.jobId}. O certificado original segue valido ate a emissao da retificacao. Motivo: ${command.reason}`,
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
  );
}
