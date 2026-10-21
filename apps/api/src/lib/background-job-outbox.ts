import { enqueueQueueJob, type QueueExecutor } from "@calibra-facil/db/queue";
import type { BackgroundJobMessage } from "@calibra-facil/shared";
import {
  getDocumentWorkerUrl,
  routesToDatabaseQueue,
} from "./background-job-routing";

/**
 * Outbox staging for background jobs. When the job is dispatched through
 * `app_queue_job` (the same Postgres), the queue row is inserted INSIDE the
 * caller's transaction, so "state changed" and "job queued" commit or roll
 * back together and the stale-lease backstop can always recover the work.
 * Dispatch (waking the document worker) happens after the commit.
 */
export type StagedBackgroundJob = { queueJobId: number };

/**
 * Inserts the queue row on `executor` when this message routes to the database
 * queue; returns null when it does not (Vercel Queue / in-process), in which
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

/** After commit: nudge the document worker to drain. Never throws. */
export async function dispatchStagedBackgroundJob(): Promise<void> {
  const url = getDocumentWorkerUrl();
  if (!url) {
    // The polling worker picks the row up.
    return;
  }
  try {
    const { wakeDocumentWorker } = await import("./background-jobs");
    // Fire-and-forget like the non-staged path: the row is durable already.
    void wakeDocumentWorker(url).catch((error) => {
      console.error("[BackgroundJobs] Failed to wake document worker", {
        error: error instanceof Error ? error.message : "unknown error",
      });
    });
  } catch (error) {
    console.error("[BackgroundJobs] Failed to wake document worker", {
      error: error instanceof Error ? error.message : "unknown error",
    });
  }
}
