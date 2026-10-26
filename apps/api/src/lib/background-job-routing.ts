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

export function getDocumentWorkerUrl(): string | null {
  return readJobsConfig().documentWorkerUrl ?? null;
}

// Mirror packages/db/src/queue.ts:getMessageType so a CERTIFICATE/LABEL job
// dispatched with `type` omitted (the optional-type variant) still resolves to
// its canonical app_queue_job type name (used to label log lines).
export function resolveQueueJobType(message: BackgroundJobMessage): string {
  switch (message.type) {
    case "LABEL":
    case "SERVICE_ORDER_INTAKE_DOCUMENT":
    case "SERVICE_ORDER_TAG":
    case "SERVICE_ORDER_QUOTE":
    case "SERVICE_ORDER_DELIVERY_RECEIPT":
    case "INTEGRATION_SYNC":
    case "AUDIT_PACK":
    case "OOT_NOTIFICATION":
    case "SCHEDULED_NOTIFICATIONS":
    case "PORTAL_DIGEST":
    case "WEBHOOK_DELIVERY":
      return message.type;
    default:
      return "CERTIFICATE";
  }
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
