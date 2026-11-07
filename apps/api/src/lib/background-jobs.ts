import { enqueueQueueJob, isQueueMessage } from "@calibra-facil/db/queue";
import {
  parseBackgroundJobMessage,
  type BackgroundJobMessage,
  type IntegrationSyncBackgroundJobMessage,
} from "@calibra-facil/schemas";
import { createWorkerRuntimeEnv } from "./runtime-env";
import {
  getBackgroundJobsMode,
  isContaAzulSyncMessage,
} from "./background-job-routing";

// Loaded on first use, not at import: the handlers of jobs-core (certificate
// rendering, signing, ...) are only needed where a job runs in this process.
async function processInProcess(message: BackgroundJobMessage) {
  const { processBackgroundJob } = await import("@calibra-facil/jobs-core");
  await processBackgroundJob(createWorkerRuntimeEnv(), message);
}

async function processContaAzulSyncMessage(
  message: IntegrationSyncBackgroundJobMessage,
) {
  // The specifier is a variable on purpose: a literal one is an import edge for
  // madge, and this one closes a cycle (lib/org-context -> lib/background-jobs ->
  // modules/integrations -> lib/finance -> lib/org-context). It is not hiding the
  // module from a bundler: the API runs from source under Bun.
  const modulePath = "../modules/integrations/index";
  const { runIntegrationSync } = await import(modulePath);
  await runIntegrationSync({
    integrationId: message.integrationId,
    organizationId: message.organizationId,
    runId: message.runId,
    target: message.target,
    limit: message.limit,
    env: createWorkerRuntimeEnv(),
  });
}

function runLocalBackgroundJob(message: BackgroundJobMessage) {
  queueMicrotask(() => {
    if (isContaAzulSyncMessage(message)) {
      processContaAzulSyncMessage(message).catch((error) => {
        console.error("[BackgroundJobs] Local Conta Azul job failed", {
          integrationId: message.integrationId,
          organizationId: message.organizationId,
          runId: message.runId,
          target: message.target,
          error: error instanceof Error ? error.message : "unknown error",
        });
      });
      return;
    }

    processInProcess(message).catch((error) => {
      console.error("[BackgroundJobs] Local job failed", { message, error });
    });
  });
}

// --- database queue ---------------------------------------------------------
//
// BACKGROUND_JOBS_MODE=queue writes every queue job to `app_queue_job` for the
// always-on worker (apps/worker/src/bun.ts) to claim by polling. Conta Azul
// syncs need this process's integration code and the cron-only messages are not
// queue jobs, so both still run here.
async function enqueueToDatabaseQueue(message: BackgroundJobMessage) {
  if (isContaAzulSyncMessage(message) || !isQueueMessage(message)) {
    runLocalBackgroundJob(message);
    return { messageId: `local-${Date.now()}` };
  }

  const jobId = await enqueueQueueJob(message);
  return { messageId: `app-queue-${jobId}` };
}

export async function enqueueBackgroundJob(input: BackgroundJobMessage) {
  // Every dispatch path (the database queue, in-process) carries a message that
  // matched its job schema; a producer that built one by hand and got it wrong
  // fails here instead of in a consumer.
  const parsed = parseBackgroundJobMessage(input);
  if (!parsed.ok) {
    throw new Error(
      `Refusing to enqueue invalid background job: ${parsed.reason}`,
    );
  }
  const message = parsed.message;

  // A job that belongs to a change is staged with `ctx.emit` of `withOrg`, which
  // keeps it from leaving before the change is durable (also inside the desktop
  // sync's transaction scope). This is the dispatch itself.
  return dispatchBackgroundJob(message);
}

function dispatchBackgroundJob(message: BackgroundJobMessage) {
  if (getBackgroundJobsMode() === "queue") {
    return enqueueToDatabaseQueue(message);
  }
  runLocalBackgroundJob(message);
  return { messageId: `local-${Date.now()}` };
}
