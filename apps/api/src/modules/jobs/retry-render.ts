import { appendJobEvent } from "@calibra-facil/db/job-events";
import { calibrationJob, type JobStatus } from "@calibra-facil/db/schema";
import {
  requireTargetOf,
  targetOf,
} from "@calibra-facil/schemas/job-transitions";
import { and, eq } from "drizzle-orm";
import { enqueueBackgroundJob } from "../../lib/background-jobs";
import {
  dispatchStagedBackgroundJob,
  stageBackgroundJob,
} from "../../lib/background-job-outbox";
import { invalid, type DomainError } from "../../lib/domain-errors";
import { orgTransactionWithExecutor } from "../../lib/org-transaction";
import {
  jobActorAuditFields,
  loadScopedJob,
  type JobLifecycleActor,
  type JobRow,
  type UnitScope,
} from "./job-actor";

/**
 * Retry the certificate render of an approved job whose render failed
 * (RENDER_FAILED -> GENERATING_PDF, roadmap 2 C5). The approval, its verdict and
 * its frozen certificate input stand: only the PDF is produced again, by the same
 * worker path an approval dispatches. The failure message is cleared from the
 * job and kept in the audit row.
 *
 *   1. load the job (organization + unit scope)
 *   2. the transition table (`retry_render`)
 *   3. the compare-and-set write, its audit row and the render queue row, in one
 *      transaction (outbox): a retry that committed always has a row the worker
 *      or the stale-lease backstop will move.
 *
 * Without the database queue (in-process dispatch, development) the render is
 * dispatched after the commit; a failure there leaves the job in GENERATING_PDF
 * for the stuck-render sweep to return it to RENDER_FAILED.
 *
 * Who may retry (`calibration:approve`) is decided by the route's guard.
 */
export type RetryRenderCommand = {
  actor: JobLifecycleActor;
  jobId: number;
  organizationId: string;
  /** The units the caller may act in; `null` is organization-wide (an API key). */
  unitScope: UnitScope | null;
};

export type RetryRenderResult =
  | { status: "ok"; job: JobRow; previousStatus: JobStatus }
  | { status: "not_found" }
  | {
      status: "illegal_transition";
      currentStatus: JobStatus;
      error: DomainError;
    }
  /** The job left the status (or organization) it was judged in; nothing written. */
  | { status: "concurrent_update" };

export async function retryRender(
  command: RetryRenderCommand,
): Promise<RetryRenderResult> {
  const { actor, organizationId } = command;

  const outcome = await orgTransactionWithExecutor(
    organizationId,
    async (o, tx) => {
      const existing = await loadScopedJob(
        {
          jobId: command.jobId,
          organizationId,
          unitScope: command.unitScope,
        },
        o,
      );
      if (!existing) return { status: "not_found" } as const;

      if (targetOf(existing.status, "retry_render") === null) {
        return {
          status: "illegal_transition",
          currentStatus: existing.status,
          error: invalid(
            "job_render_not_retryable",
            `Nao e possivel reemitir o certificado de um job com status ${existing.status}. O job deve estar em RENDER_FAILED.`,
          ),
        } as const;
      }

      const renderingStatus = requireTargetOf(existing.status, "retry_render");
      const now = new Date();
      const [updated] = await o
        .update(calibrationJob)
        .set({
          status: renderingStatus,
          rejectedBy: null,
          rejectedAt: null,
          rejectionReason: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(calibrationJob.id, existing.id),
            eq(calibrationJob.organizationId, organizationId),
            eq(calibrationJob.status, existing.status),
          ),
        )
        .returning();
      if (!updated) return { status: "concurrent_update" } as const;

      await appendJobEvent(o, {
        action: "render_retried",
        organizationId,
        jobId: existing.id,
        actor: { kind: "user", userId: actor.userId },
        performedAt: now,
        changes: {
          ...jobActorAuditFields(actor),
          status: { old: existing.status, new: renderingStatus },
          previousError: existing.rejectionReason,
        },
        ipAddress: actor.ipAddress ?? null,
      });

      const staged = await stageBackgroundJob(tx, {
        jobId: existing.id,
        userId: actor.userId,
      });
      return {
        status: "ok",
        job: updated,
        previousStatus: existing.status,
        staged,
      } as const;
    },
  );

  if (outcome.status !== "ok") return outcome;

  if (outcome.staged) {
    await dispatchStagedBackgroundJob();
  } else {
    try {
      await enqueueBackgroundJob({
        jobId: outcome.job.id,
        userId: actor.userId,
      });
    } catch (error) {
      // In-process only: the stuck-render sweep returns the job to RENDER_FAILED.
      console.error("[Jobs] Render retry dispatch failed", {
        jobId: outcome.job.id,
        error: error instanceof Error ? error.message : "unknown error",
      });
    }
  }

  return {
    status: "ok",
    job: outcome.job,
    previousStatus: outcome.previousStatus,
  };
}
