import { handleCallback } from "@vercel/queue";
import { isBackgroundJobMessage } from "@calibra-facil/shared";
import { processBackgroundJob } from "@calibra-facil/worker";
import { createWorkerRuntimeEnv } from "../../src/lib/runtime-env";

export const POST = handleCallback(async (message, metadata) => {
  if (!isBackgroundJobMessage(message)) {
    throw new Error(`Invalid background job message ${metadata.messageId}`);
  }

  await processBackgroundJob(createWorkerRuntimeEnv(), message);
});
