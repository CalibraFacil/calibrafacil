import { readJobsConfig } from "@calibra-facil/config";
import type {
  BackgroundJobMessage,
  IntegrationSyncBackgroundJobMessage,
} from "@calibra-facil/shared";
import { isQueueMessage, type QueueMessage } from "@calibra-facil/db/queue";

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

export function getDocumentWorkerJobTypes(): ReadonlySet<string> {
  return new Set(readJobsConfig().documentWorkerJobTypes);
}

// Mirror packages/db/src/queue.ts:getMessageType so a CERTIFICATE/LABEL job
// dispatched with `type` omitted (the optional-type variant) still resolves to
// its canonical app_queue_job type name for the allowlist check. Exported for
// the Vercel Queue consumer's receipt ledger (vercel-src/queues/background.ts).
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
      return message.type;
    default:
      return "CERTIFICATE";
  }
}

export function isDocumentWorkerJobType(
  message: BackgroundJobMessage,
): message is QueueMessage {
  // SCHEDULED_NOTIFICATIONS and PORTAL_DIGEST are timer-only messages, not app_queue_job types, so they can never route to
  // the container.
  if (
    message.type === "SCHEDULED_NOTIFICATIONS" ||
    message.type === "PORTAL_DIGEST"
  ) {
    return false;
  }
  return getDocumentWorkerJobTypes().has(resolveQueueJobType(message));
}

/**
 * Whether `enqueueBackgroundJob` would write this message to `app_queue_job`
 * (the same Postgres), as opposed to Vercel Queue / in-process dispatch.
 */
export function routesToDatabaseQueue(
  message: BackgroundJobMessage,
): message is QueueMessage {
  if (!isQueueMessage(message) || isContaAzulSyncMessage(message)) {
    return false;
  }
  const mode = getBackgroundJobsMode();
  if (mode === "queue") return true;
  if (mode === "local" || mode === "inline") return false;
  return getDocumentWorkerUrl() !== null && isDocumentWorkerJobType(message);
}
