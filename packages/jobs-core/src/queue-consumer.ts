import { processScheduledNotifications } from "./scheduled.js";
import { processScheduledIntegrationSyncs } from "./integrations.js";
import {
  type Env,
  type ExecutionContext,
  type MessageBatch,
  type QueueMessage,
  type ScheduledEvent,
} from "./runtime-types.js";
import { processBackgroundJob } from "./dispatcher.js";

// One message dispatcher only: every run mode routes through
// processBackgroundJob above. The old processBackgroundJobBatch re-implemented
// the same routing as a parallel filter-chain with no callers — and had
// already diverged (an unselected calibration-certificate message fell through
// to the HTML-document path instead of failing with the template-required
// error). Batch callers iterate messages and call processBackgroundJob.
export default {
  async queue(
    batch: MessageBatch<QueueMessage>,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const batchSize = batch.messages.length;
    console.log(`[BATCH] Processing ${batchSize} job(s)`);
    const batchStart = performance.now();

    for (const msg of batch.messages) {
      try {
        await processBackgroundJob(
          env,
          msg.body,
          msg.attempt !== undefined && msg.maxAttempts !== undefined
            ? { attempt: msg.attempt, maxAttempts: msg.maxAttempts }
            : undefined,
        );
        msg.ack();
      } catch (error) {
        console.error("[BATCH] Failed to process message:", {
          error,
          body: msg.body,
        });
        // Forward the real error so the DB-queue runtime records it as the job's
        // last_error (REQ-REL-OBS-002) instead of a generic placeholder.
        msg.retry(error);
      }
    }

    const batchMs = Math.round(performance.now() - batchStart);
    console.log(
      `[BATCH] Completed ${batchSize} job(s) in ${batchMs}ms (avg: ${Math.round(batchMs / batchSize)}ms/job)`,
    );
  },

  // Health check endpoint
  async fetch(request: Request, _env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response(
        JSON.stringify({ status: "ok", worker: "calibra-facil-worker" }),
        {
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    return new Response(
      JSON.stringify({
        name: "Calibra Fácil - Certificate Worker",
        description: "Queue consumer for PDF certificate generation",
        endpoints: {
          "/health": "Health check",
        },
        note: "This worker processes queue messages. Queue testing requires deployment.",
      }),
      {
        headers: { "Content-Type": "application/json" },
      },
    );
  },

  // Scheduled handlers for compliance notifications and integration syncs
  async scheduled(
    event: ScheduledEvent,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    if (event.cron === "*/30 * * * *") {
      console.log("[Scheduled] Starting integration scheduler");
      const start = performance.now();

      try {
        const result = await processScheduledIntegrationSyncs(env);
        const duration = Math.round(performance.now() - start);
        console.log(
          `[Scheduled] Integration scheduler completed in ${duration}ms: ` +
            `${result.scheduledRuns} run(s) dispatched`,
        );
      } catch (error) {
        console.error("[Scheduled] Error processing integrations:", error);
        throw error;
      }

      return;
    }

    console.log("[Scheduled] Starting daily compliance notification check");
    const start = performance.now();

    try {
      const result = await processScheduledNotifications(env);
      const duration = Math.round(performance.now() - start);

      console.log(
        `[Scheduled] Completed in ${duration}ms: ` +
          `${result.assetsProcessed} assets, ` +
          `${result.standardsProcessed} standards, ` +
          `${result.jobsProcessed} jobs, ` +
          `${result.visitsProcessed} visits, ` +
          `${result.signingCertsProcessed} signing certs`,
      );
    } catch (error) {
      console.error("[Scheduled] Error processing notifications:", error);
      throw error;
    }
  },
};
