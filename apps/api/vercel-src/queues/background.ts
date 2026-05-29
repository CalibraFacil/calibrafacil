import { handleCallback } from "@vercel/queue";
import { isBackgroundJobMessage } from "@calibra-facil/shared";
import { processBackgroundJob } from "@calibra-facil/worker";
import { runIntegrationSync } from "../../src/lib/integrations";
import { createWorkerRuntimeEnv } from "../../src/lib/runtime-env";

export const POST = handleCallback(async (message, metadata) => {
  if (!isBackgroundJobMessage(message)) {
    throw new Error(`Invalid background job message ${metadata.messageId}`);
  }

  const env = createWorkerRuntimeEnv();

  if (message.type === "INTEGRATION_SYNC" && message.provider === "conta_azul") {
    await runIntegrationSync({
      integrationId: message.integrationId,
      organizationId: message.organizationId,
      runId: message.runId,
      target: message.target,
      limit: message.limit,
      env,
    });
    return;
  }

  await processBackgroundJob(env, message);
});
