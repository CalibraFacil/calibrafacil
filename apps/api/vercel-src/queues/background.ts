import { handleCallback } from "@vercel/queue";
import { isBackgroundJobMessage } from "@calibra-facil/shared";
import {
  runWithQueueReceipt,
  vercelQueueReceiptKey,
} from "@calibra-facil/db/queue-receipts";
import { processBackgroundJob } from "@calibra-facil/worker";
import { resolveQueueJobType } from "../../src/lib/background-jobs";
import { runIntegrationSync } from "../../src/lib/integrations";
import { createWorkerRuntimeEnv } from "../../src/lib/runtime-env";

export const POST = handleCallback(async (message, metadata) => {
  if (!isBackgroundJobMessage(message)) {
    throw new Error(`Invalid background job message ${metadata.messageId}`);
  }

  // Vercel Queue is at-least-once: an unacknowledged (or slow) delivery is
  // redelivered with the SAME messageId. The receipt ledger keyed
  // by that messageId makes each delivery unit run-to-success exactly once —
  // in enforce mode a completed duplicate is skipped (acked without work), and
  // a held lease throws so Vercel redelivers later, when the receipt is either
  // COMPLETED (skip) or expired (take over).
  await runWithQueueReceipt(
    {
      jobType: resolveQueueJobType(message),
      idempotencyKey: vercelQueueReceiptKey(metadata.messageId),
    },
    async () => {
      const env = createWorkerRuntimeEnv();

      if (
        message.type === "INTEGRATION_SYNC" &&
        message.provider === "conta_azul"
      ) {
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
    },
  );
});
