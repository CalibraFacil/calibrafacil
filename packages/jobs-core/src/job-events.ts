import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  appendJobEvent,
  type JobEventActor,
} from "@calibra-facil/db/job-events";
import {
  allowedFrom,
  requireTargetOf,
} from "@calibra-facil/schemas/job-transitions";

/** Runs `operation` in one transaction on `client`; rolls back on any throw. */
async function inTransaction<T>(
  client: Client,
  operation: () => Promise<T>,
): Promise<T> {
  await client.query("BEGIN");
  try {
    const result = await operation();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch((rollbackError) => {
      console.error("[worker] ROLLBACK failed:", rollbackError);
    });
    throw error;
  }
}

/**
 * `inTransaction` that names the laboratory first, for row-level security
 * (migration 0123): `set_config('calibra.organization_id', $org, true)`. The
 * third argument is `is_local`, so the setting ends with the transaction and
 * never reaches the next one on a pooled connection. Under the table owner the
 * setting is inert; as `calibra_app` it is what lets the statements of the
 * transaction see the laboratory's rows. Every per-job statement of the worker
 * runs in one of these; only the lookup that LEARNS the laboratory of a job
 * (`findJobOrganization`) does not.
 */
export function inOrganizationTransaction<T>(
  client: Client,
  organizationId: string,
  operation: () => Promise<T>,
): Promise<T> {
  return inTransaction(client, async () => {
    await client.query(
      "select set_config('calibra.organization_id', $1, true)",
      [organizationId],
    );
    return operation();
  });
}

/**
 * The transaction handle appendJobEvent writes on: Drizzle over the worker's own
 * pg client, so the audit row is part of whatever BEGIN the caller opened on it.
 */
export function jobEventTransaction(client: Client) {
  return drizzle(client);
}

/**
 * The worker records its events against the user whose release it is finishing
 * (job_audit_log.performed_by is a NOT NULL foreign key to the user table).
 */
export function workerJobActor(userId: string): JobEventActor {
  return { kind: "system", source: "worker", onBehalfOf: userId };
}

/**
 * The organization a job row returned by the statement that just updated it belongs
 * to. The audit rows below name it explicitly (never through a SELECT that could
 * silently insert nothing): a job that is gone means there is no audit row to write.
 */
export function jobOrganizationOf(
  rows: ReadonlyArray<{ organization_id?: unknown }>,
  jobId: number,
): string {
  const organizationId = rows[0]?.organization_id;
  if (typeof organizationId !== "string" || organizationId.length === 0) {
    throw new Error(
      `Job ${jobId} has no organization_id to write its audit row`,
    );
  }
  return organizationId;
}

/**
 * Records a failed emission: GENERATING_PDF -> RENDER_FAILED (roadmap 2 C5; the
 * approval stands, a manager retries the render or rejects the job). Compare-and-set
 * on GENERATING_PDF, so a job that was cancelled, already approved or amended in the
 * meantime is never flipped by a late failure.
 */
export async function setJobError(
  client: Client,
  organizationId: string,
  jobId: number,
  error: string,
  userId: string,
): Promise<void> {
  const now = new Date();
  const renderingStatus = "GENERATING_PDF";
  const failedStatus = requireTargetOf(renderingStatus, "fail_render");

  await inOrganizationTransaction(client, organizationId, async () => {
    const updated = await client.query<{ id: number; organization_id: string }>(
      `
      UPDATE calibration_job
      SET
        status = $5,
        rejection_reason = $2,
        rejected_by = $3,
        rejected_at = $4,
        updated_at = $4
      WHERE id = $1 AND status = ANY($6::text[])
      RETURNING id, organization_id
      `,
      [
        jobId,
        `Erro ao gerar certificado: ${error}`,
        userId,
        now,
        failedStatus,
        allowedFrom("fail_render"),
      ],
    );
    if (updated.rows.length === 0) {
      console.warn(
        `[JOB ${jobId}] Not marking ${failedStatus}: job is no longer GENERATING_PDF (error was: ${error})`,
      );
      return;
    }

    await appendJobEvent(jobEventTransaction(client), {
      action: "certificate_error",
      organizationId: jobOrganizationOf(updated.rows, jobId),
      jobId,
      actor: workerJobActor(userId),
      performedAt: now,
      reason: error,
      changes: { status: { old: renderingStatus, new: failedStatus } },
    });
  });
}
