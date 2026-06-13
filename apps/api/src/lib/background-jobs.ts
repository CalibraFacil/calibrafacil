import { send } from "@vercel/queue";
import { enqueueQueueJob, type QueueMessage } from "@calibra-facil/db/queue";
import type {
  BackgroundJobMessage,
  IntegrationSyncBackgroundJobMessage,
} from "@calibra-facil/shared";
import { createWorkerRuntimeEnv } from "./runtime-env";

export const BACKGROUND_JOBS_TOPIC =
  process.env.BACKGROUND_JOBS_TOPIC ?? "calibra-facil-background-jobs";

type EnqueueBackgroundJobOptions = {
  idempotencyKey?: string;
};

function getBackgroundJobsMode() {
  return (
    process.env.BACKGROUND_JOBS_MODE ??
    (process.env.VERCEL ? "vercel" : "local")
  );
}

async function importLocalWorkerModule() {
  const modulePath = "./worker-modules";
  const { importWorkerModule } = await import(modulePath);
  return importWorkerModule();
}

function isContaAzulSyncMessage(
  message: BackgroundJobMessage,
): message is IntegrationSyncBackgroundJobMessage & { provider: "conta_azul" } {
  return (
    message.type === "INTEGRATION_SYNC" && message.provider === "conta_azul"
  );
}

async function processContaAzulSyncMessage(
  message: IntegrationSyncBackgroundJobMessage,
) {
  const modulePath = "./integrations";
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
// `.goals/document-worker-extraction.md`.

const DOCUMENT_WORKER_DRAIN_PATH = "/drain";

function getDocumentWorkerUrl(): string | null {
  const url = process.env.DOCUMENT_WORKER_URL?.trim();
  return url ? url : null;
}

function getDocumentWorkerJobTypes(): ReadonlySet<string> {
  return new Set(
    (process.env.DOCUMENT_WORKER_JOB_TYPES ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  );
}

// Mirror packages/db/src/queue.ts:getMessageType so a CERTIFICATE/LABEL job
// dispatched with `type` omitted (the optional-type variant) still resolves to
// its canonical app_queue_job type name for the allowlist check.
function resolveQueueJobType(message: BackgroundJobMessage): string {
  switch (message.type) {
    case "LABEL":
    case "SERVICE_ORDER_INTAKE_DOCUMENT":
    case "SERVICE_ORDER_TAG":
    case "SERVICE_ORDER_QUOTE":
    case "SERVICE_ORDER_DELIVERY_RECEIPT":
    case "INTEGRATION_SYNC":
    case "CERTIFICATE_XLSX_PREVIEW":
    case "SCHEDULED_NOTIFICATIONS":
    case "PORTAL_DIGEST":
      return message.type;
    default:
      return "CERTIFICATE";
  }
}

function isDocumentWorkerJobType(
  message: BackgroundJobMessage,
): message is QueueMessage {
  // SCHEDULED_NOTIFICATIONS and PORTAL_DIGEST are timer-only messages, not
  // app_queue_job types, so they can never route to the container.
  if (
    message.type === "SCHEDULED_NOTIFICATIONS" ||
    message.type === "PORTAL_DIGEST"
  ) {
    return false;
  }
  return getDocumentWorkerJobTypes().has(resolveQueueJobType(message));
}

// The container scales to zero after 15m idle, so the first drain ping after an
// idle period has to outlast a cold start: Cloudflare holds the request open
// while the container boots, then the container answers 202 and drains
// asynchronously. The previous single 4s timeout aborted mid cold-start — and
// nothing re-claims an un-claimed PENDING row (stale-release only re-queues rows
// already PROCESSING) — so a job enqueued while the container was asleep sat
// stranded in PENDING / `GENERATING_PDF` until the next enqueue or a manual
// drain. We now use a longer per-attempt timeout plus a couple of retries so the
// wake reliably lands. Tunable via env without a redeploy.
const DEFAULT_WAKE_TIMEOUT_MS = 12_000;
const DEFAULT_WAKE_ATTEMPTS = 2;
const DEFAULT_WAKE_RETRY_DELAY_MS = 500;

function readWakeConfig() {
  const timeoutMs = Number(process.env.DOCUMENT_WORKER_WAKE_TIMEOUT_MS);
  const attempts = Number(process.env.DOCUMENT_WORKER_WAKE_ATTEMPTS);
  const retryDelayMs = Number(process.env.DOCUMENT_WORKER_WAKE_RETRY_DELAY_MS);
  return {
    timeoutMs:
      Number.isFinite(timeoutMs) && timeoutMs > 0
        ? timeoutMs
        : DEFAULT_WAKE_TIMEOUT_MS,
    attempts:
      Number.isFinite(attempts) && attempts >= 1
        ? Math.floor(attempts)
        : DEFAULT_WAKE_ATTEMPTS,
    retryDelayMs:
      Number.isFinite(retryDelayMs) && retryDelayMs >= 0
        ? retryDelayMs
        : DEFAULT_WAKE_RETRY_DELAY_MS,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Exported for unit tests; not part of the module's public surface. Resolves as
// soon as any attempt gets a 2xx (the container answers 202, then drains), and
// throws only after every attempt fails.
export async function wakeDocumentWorker(baseUrl: string): Promise<void> {
  const token = process.env.DOCUMENT_WORKER_TOKEN;
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
  message: BackgroundJobMessage,
  options: EnqueueBackgroundJobOptions = {},
) {
  const mode = getBackgroundJobsMode();

  if (mode === "local") {
    runLocalBackgroundJob(message);
    return { messageId: `local-${Date.now()}` };
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
    region: process.env.VERCEL_QUEUE_REGION ?? "gru1",
    idempotencyKey: options.idempotencyKey,
  });

  return { messageId: result.messageId };
}
