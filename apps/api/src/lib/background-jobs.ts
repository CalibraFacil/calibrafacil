import { send } from "@vercel/queue";
import type { BackgroundJobMessage } from "@calibra-facil/shared";
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

function runLocalBackgroundJob(message: BackgroundJobMessage) {
  queueMicrotask(() => {
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
