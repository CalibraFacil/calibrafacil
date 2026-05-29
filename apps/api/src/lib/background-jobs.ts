import { send } from "@vercel/queue";
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
  return message.type === "INTEGRATION_SYNC" && message.provider === "conta_azul";
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

  const result = await send(BACKGROUND_JOBS_TOPIC, message, {
    region: process.env.VERCEL_QUEUE_REGION ?? "gru1",
    idempotencyKey: options.idempotencyKey,
  });

  return { messageId: result.messageId };
}
