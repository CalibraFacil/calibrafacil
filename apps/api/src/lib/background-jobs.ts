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
      return message.type;
    default:
      return "CERTIFICATE";
  }
}

function isDocumentWorkerJobType(
  message: BackgroundJobMessage,
): message is QueueMessage {
  // SCHEDULED_NOTIFICATIONS is a timer-only message, not an app_queue_job type,
  // so it can never route to the container.
  if (message.type === "SCHEDULED_NOTIFICATIONS") return false;
  return getDocumentWorkerJobTypes().has(resolveQueueJobType(message));
}

async function wakeDocumentWorker(baseUrl: string): Promise<void> {
  const token = process.env.DOCUMENT_WORKER_TOKEN;
  const timeoutMs = Number(
    process.env.DOCUMENT_WORKER_WAKE_TIMEOUT_MS ?? 4_000,
  );
  const headers: Record<string, string> = {};
  if (token) headers["X-Worker-Token"] = token;

  await fetch(new URL(DOCUMENT_WORKER_DRAIN_PATH, baseUrl), {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function enqueueViaDocumentWorker(
  message: QueueMessage,
  baseUrl: string,
) {
  const jobId = await enqueueQueueJob(message);

  // Best-effort wake: the job is durably enqueued regardless. A failed wake is
  // recovered by the next enqueue's drain or the container's stale-job release.
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
