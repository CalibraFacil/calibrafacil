import { enqueueQueueJob, type QueueExecutor } from "@calibra-facil/db/queue";
import type { BackgroundJobMessage } from "@calibra-facil/schemas";
import { routesToDatabaseQueue } from "./background-job-routing";

/**
 * Outbox staging for background jobs. When the job is dispatched through
 * `app_queue_job` (the same Postgres), the queue row is inserted INSIDE the
 * caller's transaction, so "state changed" and "job queued" commit or roll
 * back together and the stale-lease backstop can always recover the work. There
 * is nothing to dispatch afterwards: the always-on worker polls the table.
 */
export type StagedBackgroundJob = { queueJobId: number };

/**
 * Inserts the queue row on `executor` when this message routes to the database
 * queue; returns null when it does not (in-process), in which
 * case the caller dispatches after commit with `enqueueBackgroundJob` and must
 * compensate if that fails.
 */
export async function stageBackgroundJob(
  executor: QueueExecutor,
  message: BackgroundJobMessage,
): Promise<StagedBackgroundJob | null> {
  if (!routesToDatabaseQueue(message)) {
    return null;
  }
  const queueJobId = await enqueueQueueJob(message, { executor });
  return { queueJobId };
}
