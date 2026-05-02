import { handleCallback } from "@vercel/queue";
import { isBackgroundJobMessage } from "@calibra-facil/shared";
import { createWorkerRuntimeEnv } from "../../src/lib/runtime-env";
import { importWorkerModule } from "../../src/lib/worker-modules";

export const POST = handleCallback(async (message, metadata) => {
  if (!isBackgroundJobMessage(message)) {
    throw new Error(`Invalid background job message ${metadata.messageId}`);
  }

  const { processBackgroundJob } = await importWorkerModule();
  await processBackgroundJob(createWorkerRuntimeEnv(), message);
});
