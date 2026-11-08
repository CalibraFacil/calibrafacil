import {
  ContaAzulSyncMessageSchema,
  type ContaAzulSyncMessage,
} from "@calibra-facil/schemas";
import { createWorkerRuntimeEnv } from "../../../lib/runtime-env";
import { runIntegrationSync } from "./sync-run";
import { reportServerError } from "../../../lib/observability";

/**
 * Starts a Conta Azul sync in this process and returns without waiting for it.
 *
 * Conta Azul's client (OAuth refresh, catalog, push) lives in the API's
 * integrations module, not in `@calibra-facil/jobs-core`, so these syncs are
 * never `app_queue_job` rows and the worker cannot run them. The producers
 * (`domains/finance/routes/integrations.ts`, the scheduled-sync cron) call this directly. The
 * message is not a `BackgroundJobMessage` (see `ContaAzulSyncMessageSchema`), so
 * it cannot be passed to `enqueueBackgroundJob` by accident.
 *
 * Rejects only when the message is malformed; a failure of the sync itself is
 * logged (the run row carries the outcome).
 */
export async function dispatchContaAzulSync(message: ContaAzulSyncMessage) {
  const parsed = ContaAzulSyncMessageSchema.safeParse(message);
  if (!parsed.success) {
    throw new Error(
      `Refusing to start invalid Conta Azul sync: ${parsed.error.message}`,
    );
  }

  queueMicrotask(() => {
    runIntegrationSync({
      integrationId: message.integrationId,
      organizationId: message.organizationId,
      runId: message.runId,
      target: message.target,
      limit: message.limit,
      env: createWorkerRuntimeEnv(),
    }).catch((error) => {
      reportServerError(error, {
        surface: "conta-azul-local-sync",
        tags: {
          integrationId: message.integrationId,
          organizationId: message.organizationId,
          runId: message.runId,
          target: message.target,
        },
      });
    });
  });

  return { messageId: `local-${Date.now()}` };
}
