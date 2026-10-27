import { appendCertificateStatusEvent } from "@calibra-facil/db/certificate-status-events";
import { appendJobEvent } from "@calibra-facil/db/job-events";
import {
  calibrationJob,
  issuedCertificateSnapshot,
  type JobStatus,
} from "@calibra-facil/db/schema";
import { and, eq } from "drizzle-orm";
import { loadCertificateLifecycles } from "../../lib/certificate-lifecycle";
import { conflict, type DomainError } from "../../lib/domain-errors";
import { orgDb } from "../../lib/org-db";
import { buildUnitScopeCondition } from "../../lib/units";
import {
  jobActorAuditFields,
  type JobLifecycleActor,
  type UnitScope,
} from "./job-actor";

/**
 * Withdraw an issued certificate (ISO/IEC 17025:2017 §7.10 nonconforming work,
 * e.g. after a recall of a reference standard): the certificate must no longer
 * be relied on. The ONE implementation behind the cloud route.
 *
 * It appends a WITHDRAWN row to the certificate's append-only status stream
 * (`issued_certificate_status_event`) and audits the job. The JOB's status does
 * not change: an approved record stays an approved, immutable record (the
 * transition table has no withdraw move), and the verification page and the
 * portal derive "withdrawn" from the latest event. Only a certificate that was
 * issued (APPROVED, or SUPERSEDED by an amendment) can be withdrawn, once: a
 * second withdrawal is refused.
 *
 * Everything runs in one transaction serialised on the job's row (`FOR UPDATE`),
 * so two concurrent withdrawals cannot both pass the "not already withdrawn"
 * check. A refusal writes nothing.
 */
export type WithdrawCertificateCommand = {
  actor: JobLifecycleActor;
  jobId: number;
  organizationId: string;
  unitScope: UnitScope | null;
  /** The written reason (mandatory), kept on the event and the audit row. */
  reason: string;
};

export type WithdrawCertificateResult =
  | {
      status: "ok";
      jobId: number;
      jobNumber: string;
      jobStatus: JobStatus;
      withdrawnAt: Date;
    }
  | { status: "not_found" }
  | { status: "not_issued"; error: DomainError }
  | { status: "already_withdrawn"; error: DomainError };

export async function withdrawCertificate(
  command: WithdrawCertificateCommand,
): Promise<WithdrawCertificateResult> {
  const { actor, organizationId } = command;
  const reason = command.reason.trim();
  if (reason.length === 0) {
    throw new Error("A withdrawal needs a written reason");
  }

  return orgDb(organizationId).transaction(
    async (o): Promise<WithdrawCertificateResult> => {
      const [job] = await o
        .select({
          id: calibrationJob.id,
          jobId: calibrationJob.jobId,
          status: calibrationJob.status,
          supersededById: calibrationJob.supersededById,
        })
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.id, command.jobId),
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
      if (!job) return { status: "not_found" };

      const [certificate] = await o
        .select({ id: issuedCertificateSnapshot.id })
        .from(issuedCertificateSnapshot)
        .where(eq(issuedCertificateSnapshot.jobId, job.id))
        .limit(1);
      if (
        !certificate ||
        (job.status !== "APPROVED" && job.status !== "SUPERSEDED")
      ) {
        return {
          status: "not_issued",
          error: conflict(
            "certificate_not_issued",
            `Apenas certificados emitidos podem ser retirados. Status atual: ${job.status}`,
          ),
        };
      }

      const lifecycle = (await loadCertificateLifecycles(o, [job])).get(job.id);
      if (lifecycle?.status === "WITHDRAWN") {
        return {
          status: "already_withdrawn",
          error: conflict(
            "certificate_already_withdrawn",
            "Este certificado ja foi retirado",
          ),
        };
      }

      const withdrawnAt = new Date();
      await appendCertificateStatusEvent(o, {
        organizationId,
        certificateId: certificate.id,
        jobId: job.id,
        event: "WITHDRAWN",
        reason,
        actorUserId: actor.userId,
        source: "api",
        occurredAt: withdrawnAt,
      });
      await appendJobEvent(o, {
        action: "certificate_withdrawn",
        organizationId,
        jobId: job.id,
        actor: { kind: "user", userId: actor.userId },
        performedAt: withdrawnAt,
        changes: {
          ...jobActorAuditFields(actor),
          certificateStatus: {
            old: lifecycle?.status ?? "ISSUED",
            new: "WITHDRAWN",
          },
          reason,
        },
        ipAddress: actor.ipAddress ?? null,
        reason,
      });

      return {
        status: "ok",
        jobId: job.id,
        jobNumber: job.jobId,
        jobStatus: job.status,
        withdrawnAt,
      };
    },
  );
}
