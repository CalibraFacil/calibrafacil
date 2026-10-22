import { readJobsConfig } from "@calibra-facil/config";
import { send } from "@vercel/queue";
import {
  afterTransactionCommit,
  isInTransactionScope,
} from "@calibra-facil/db";
import { enqueueQueueJob, isQueueMessage } from "@calibra-facil/db/queue";
import {
  parseBackgroundJobMessage,
  type BackgroundJobMessage,
  type IntegrationSyncBackgroundJobMessage,
  type QueueMessage,
} from "@calibra-facil/schemas";
import { createWorkerRuntimeEnv } from "./runtime-env";
import {
  getBackgroundJobsMode,
  getDocumentWorkerUrl,
  isContaAzulSyncMessage,
  isDocumentWorkerJobType,
  resolveQueueJobType,
  routesToDatabaseQueue,
} from "./background-job-routing";

export { resolveQueueJobType };

export const BACKGROUND_JOBS_TOPIC = readJobsConfig().topic;

type EnqueueBackgroundJobOptions = {
  idempotencyKey?: string;
};

async function importLocalWorkerModule() {
  const modulePath = "./worker-modules";
  const { importWorkerModule } = await import(modulePath);
  return importWorkerModule();
}

async function processContaAzulSyncMessage(
  message: IntegrationSyncBackgroundJobMessage,
) {
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

    importLocalWorkerModule()
      .then(({ processBackgroundJob }) =>
        processBackgroundJob(createWorkerRuntimeEnv(), message),
      )
      .catch((error) => {
        console.error("[BackgroundJobs] Local job failed", { message, error });
      });
  });
}

// --- document-worker dispatch (Cloudflare Container) -----------------------
//
// When configured, render jobs are durably enqueued into `app_queue_job` and
// the `services/document-worker` container is pinged to drain them, instead of
// going through Vercel Queue. This is an opt-in, per-job-type allowlist
// (default empty = everything stays on Vercel Queue), so cutover and rollback
// are a single env-var change with no redeploy. See
// `services/document-worker/README.md`.

const DOCUMENT_WORKER_DRAIN_PATH = "/drain";

// The container scales to zero after 15m idle, so the first drain ping after an
// idle period has to outlast a cold start: Cloudflare holds the request open
// while the container boots, then the container answers 202 and drains
// asynchronously. The previous single 4s timeout aborted mid cold-start — and
// nothing re-claims an un-claimed PENDING row (stale-release only re-queues rows
// already PROCESSING) — so a job enqueued while the container was asleep sat
// stranded in PENDING / `GENERATING_PDF` until the next enqueue or a manual
// drain. We now use a longer per-attempt timeout plus a couple of retries so the
// wake reliably lands. Tunable via env without a redeploy.
// The defaults live with the other settings in packages/config (jobs).

function readWakeConfig() {
  const config = readJobsConfig();
  return {
    timeoutMs: config.documentWorkerWakeTimeoutMs,
    attempts: config.documentWorkerWakeAttempts,
    retryDelayMs: config.documentWorkerWakeRetryDelayMs,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Exported for unit tests; not part of the module's public surface. Resolves as
// soon as any attempt gets a 2xx (the container answers 202, then drains), and
// throws only after every attempt fails.
export async function wakeDocumentWorker(baseUrl: string): Promise<void> {
  const token = readJobsConfig().documentWorkerToken;
  const { timeoutMs, attempts, retryDelayMs } = readWakeConfig();
  const headers: Record<string, string> = {};
  if (token) headers["X-Worker-Token"] = token;
  const url = new URL(DOCUMENT_WORKER_DRAIN_PATH, baseUrl);

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      // oxlint-disable-next-line eslint/no-await-in-loop -- retries are inherently sequential: each attempt must wait for the previous one to fail.
      const response = await fetch(url, {
        method: "POST",
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) return;
      lastError = new Error(`Drain ping returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts && retryDelayMs > 0) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- intentional backoff between sequential retry attempts.
      await delay(retryDelayMs);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to wake document worker");
}

// --- database queue (self-hosted worker) ------------------------------------
//
// BACKGROUND_JOBS_MODE=queue writes every queue job to `app_queue_job` for a
// separate process to drain: the polling worker (apps/worker/src/bun.ts), or
// the document worker's drain server, which DOCUMENT_WORKER_URL wakes after
// each enqueue. Conta Azul syncs need this process's integration code and the
// cron-only messages are not queue jobs, so both still run here.
async function enqueueToDatabaseQueue(message: BackgroundJobMessage) {
  if (isContaAzulSyncMessage(message) || !isQueueMessage(message)) {
    runLocalBackgroundJob(message);
    return { messageId: `local-${Date.now()}` };
  }

  const documentWorkerUrl = getDocumentWorkerUrl();
  if (documentWorkerUrl) {
    return enqueueViaDocumentWorker(message, documentWorkerUrl);
  }

  const jobId = await enqueueQueueJob(message);
  return { messageId: `app-queue-${jobId}` };
}

async function enqueueViaDocumentWorker(
  message: QueueMessage,
  baseUrl: string,
) {
  const jobId = await enqueueQueueJob(message);

  // Fire-and-forget so the enqueueing request returns immediately; the wake runs
  // after the HTTP response (within the function's maxDuration). The job is
  // durably enqueued regardless, so a fully failed wake only delays the render
  // until the next enqueue's drain or a manual drain.
  void wakeDocumentWorker(baseUrl).catch((error) => {
    console.error("[BackgroundJobs] Failed to wake document worker", {
      type: resolveQueueJobType(message),
      error: error instanceof Error ? error.message : "unknown error",
    });
  });

  return { messageId: `app-queue-${jobId}` };
}

export async function enqueueBackgroundJob(
  input: BackgroundJobMessage,
  options: EnqueueBackgroundJobOptions = {},
) {
  // Every dispatch path (Vercel Queue, the database queue, in-process) carries
  // a message that matched its job schema; a producer that built one by hand
  // and got it wrong fails here instead of in a consumer.
  const parsed = parseBackgroundJobMessage(input);
  if (!parsed.ok) {
    throw new Error(
      `Refusing to enqueue invalid background job: ${parsed.reason}`,
    );
  }
  const message = parsed.message;

  // Inside a transaction scope (the desktop sync apply) the job must not leave
  // the process before the state it is about for is durable, and must not leave
  // at all when the transaction rolls back:
  // - a row of the database queue is inserted in the transaction, so it commits
  //   or rolls back with the change (the wake-up ping goes after the commit);
  // - every other dispatch (Vercel Queue, the document-worker ping, in-process
  //   `local`/`inline` work that reads the committed rows) is sent after the
  //   commit and never on a rollback.
  if (isInTransactionScope()) {
    if (routesToDatabaseQueue(message)) {
      const jobId = await enqueueQueueJob(message);
      const documentWorkerUrl = getDocumentWorkerUrl();
      if (documentWorkerUrl) {
        // Fire-and-forget like the unscoped path: the row is durable already.
        afterTransactionCommit(() => {
          void wakeAfterCommit(message, documentWorkerUrl);
        });
      }
      return { messageId: `app-queue-${jobId}` };
    }
    afterTransactionCommit(async () => {
      await dispatchBackgroundJob(message, options);
    });
    return { messageId: `deferred-${Date.now()}` };
  }

  return dispatchBackgroundJob(message, options);
}

async function wakeAfterCommit(message: QueueMessage, baseUrl: string) {
  try {
    await wakeDocumentWorker(baseUrl);
  } catch (error) {
    console.error("[BackgroundJobs] Failed to wake document worker", {
      type: resolveQueueJobType(message),
      error: error instanceof Error ? error.message : "unknown error",
    });
  }
}

async function dispatchBackgroundJob(
  message: BackgroundJobMessage,
  options: EnqueueBackgroundJobOptions,
) {
  const mode = getBackgroundJobsMode();

  if (mode === "local") {
    runLocalBackgroundJob(message);
    return { messageId: `local-${Date.now()}` };
  }

  if (mode === "queue") {
    return enqueueToDatabaseQueue(message);
  }

  if (mode === "inline") {
    if (isContaAzulSyncMessage(message)) {
      await processContaAzulSyncMessage(message);
      return { messageId: `inline-${Date.now()}` };
    }

    const { processBackgroundJob } = await importLocalWorkerModule();
    await processBackgroundJob(createWorkerRuntimeEnv(), message);
    return { messageId: `inline-${Date.now()}` };
  }

  const documentWorkerUrl = getDocumentWorkerUrl();
  if (documentWorkerUrl && isDocumentWorkerJobType(message)) {
    return enqueueViaDocumentWorker(message, documentWorkerUrl);
  }

  const result = await send(BACKGROUND_JOBS_TOPIC, message, {
    region: readJobsConfig().vercelQueueRegion,
    idempotencyKey: options.idempotencyKey,
  });

  return { messageId: result.messageId };
}
