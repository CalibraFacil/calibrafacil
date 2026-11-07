import { flushWorkerErrorReporter, reportWorkerError } from "./observability";
import { processSpcRecompute } from "./spc-recompute";
import { processEmailDomainHealth } from "./email-domain-health";
import {
  processPortalDigest,
  processScheduledNotifications,
} from "./scheduled.js";
import { processIntegrationSync } from "./integrations.js";
import {
  backgroundJobType,
  type BackgroundJobMessage,
} from "@calibra-facil/schemas";
import { type DeliveryAttempt, type Env } from "./runtime-types.js";
import { processAuditPackJob } from "./audit-pack.js";
import { processWebhookDelivery } from "./webhook-delivery.js";
import { processDocumentMessage } from "./document-messages.js";
import {
  processAssetOotNotification,
  processJobApprovedNotification,
} from "./approval-notifications.js";

// one capture site covering every run mode (container drain, local poller, inline/local dev): a failing job is
// reported with structural tags before the error continues into the caller's
// retry path. Flush is bounded so a serverless caller doesn't freeze with the
// event still in flight.
export async function processBackgroundJob(
  env: Env,
  message: BackgroundJobMessage,
  delivery?: DeliveryAttempt,
) {
  try {
    await processBackgroundJobUnreported(env, message, delivery);
  } catch (error) {
    reportWorkerError(error, { jobType: backgroundJobType(message) });
    await flushWorkerErrorReporter();
    throw error;
  }
}

async function processBackgroundJobUnreported(
  env: Env,
  message: BackgroundJobMessage,
  delivery?: DeliveryAttempt,
) {
  switch (message.type) {
    case "AUDIT_PACK":
      return processAuditPackJob(env, message);
    case "JOB_APPROVED_NOTIFICATION":
      return processJobApprovedNotification(message);
    case "ASSET_OOT_NOTIFICATION":
      return processAssetOotNotification(message);
    case "INTEGRATION_SYNC":
      return processIntegrationSync(env, message);
    case "WEBHOOK_DELIVERY":
      return processWebhookDelivery(env, message, delivery);
    case "SCHEDULED_NOTIFICATIONS":
      return processScheduledNotifications(env);
    case "PORTAL_DIGEST":
      return processPortalDigest();
    case "SPC_RECOMPUTE":
      return processSpcRecompute();
    case "EMAIL_DOMAIN_HEALTH":
      return processEmailDomainHealth();
    case undefined:
    case "CERTIFICATE":
    case "LABEL":
    case "SERVICE_ORDER_INTAKE_DOCUMENT":
    case "SERVICE_ORDER_TAG":
    case "SERVICE_ORDER_QUOTE":
    case "SERVICE_ORDER_DELIVERY_RECEIPT":
    case "OOT_NOTIFICATION":
      // HTML/label documents render through the hosted Gotenberg service.
      return processDocumentMessage(env, message, delivery);
    default:
      return assertNever(message);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled background job ${JSON.stringify(value)}`);
}
