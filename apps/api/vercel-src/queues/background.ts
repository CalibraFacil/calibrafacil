import "../assert-config";
import { handleCallback } from "@vercel/queue";
import { parseBackgroundJobMessage } from "@calibra-facil/schemas";
import {
  QueueReceiptHeldError,
  runWithQueueReceipt,
  vercelQueueReceiptKey,
} from "@calibra-facil/db/queue-receipts";
import { processBackgroundJob } from "@calibra-facil/worker";
import { resolveQueueJobType } from "../../src/lib/background-jobs";
import { runIntegrationSync } from "../../src/modules/integrations";
import {
  vercelDeliveryAttempt,
  vercelRetryDirective,
} from "../../src/lib/queue-delivery";
import { createWorkerRuntimeEnv } from "../../src/lib/runtime-env";

export const POST = handleCallback(
  async (body, metadata) => {
    // The same parse step the database drain runs before a handler. A message
    // that cannot parse can never succeed, so it is dead-lettered (logged with
    // its reason and acknowledged) instead of thrown into redelivery.
    const parsed = parseBackgroundJobMessage(body);
    if (!parsed.ok) {
      console.error(
        `[Queue] dead-lettering Vercel Queue message ${metadata.messageId}: ${parsed.reason}`,
      );
      return;
    }
    const message = parsed.message;

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

        // deliveryCount lets the worker keep a certificate in GENERATING_PDF on
        // a transient failure and REJECT it only on the last delivery.
        await processBackgroundJob(
          env,
          message,
          vercelDeliveryAttempt(metadata.deliveryCount),
        );
      },
    );
  },
  {
    // Vercel Queue has no max-deliveries setting (it retries until the message
    // expires), so the ceiling is enforced here: acknowledge after the final
    // delivery, the same one the worker treats as final. See queue-delivery.ts.
    retry: (error, metadata) =>
      vercelRetryDirective({
        deliveryCount: metadata.deliveryCount,
        leaseHeld: error instanceof QueueReceiptHeldError,
      }),
  },
);
