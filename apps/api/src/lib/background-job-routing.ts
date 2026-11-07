import { readJobsConfig } from "@calibra-facil/config";
import type {
  BackgroundJobMessage,
  IntegrationSyncBackgroundJobMessage,
  QueueMessage,
} from "@calibra-facil/schemas";
import { isQueueMessage } from "@calibra-facil/db/queue";

// Where a background job is dispatched. Kept free of side effects (no queue
// client, no worker imports) so the approval transaction can ask "does this
// job land in `app_queue_job`?" without pulling the dispatcher in.

export function getBackgroundJobsMode() {
  return readJobsConfig().mode;
}

export function isContaAzulSyncMessage(
  message: BackgroundJobMessage,
): message is IntegrationSyncBackgroundJobMessage & { provider: "conta_azul" } {
  return (
    message.type === "INTEGRATION_SYNC" && message.provider === "conta_azul"
  );
}

/**
 * Whether `enqueueBackgroundJob` writes this message to `app_queue_job` (the
 * same Postgres), as opposed to running it in-process: every queue job in
 * `queue` mode except the ones that need this process (Conta Azul syncs) and
 * the cron-only messages, which are not queue jobs.
 */
export function routesToDatabaseQueue(
  message: BackgroundJobMessage,
): message is QueueMessage {
  if (!isQueueMessage(message) || isContaAzulSyncMessage(message)) {
    return false;
  }
  return getBackgroundJobsMode() === "queue";
}
