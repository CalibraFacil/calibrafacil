import { flushWorkerErrorReporter, reportWorkerError } from "./observability";
import { processSpcRecompute } from "./spc-recompute";
import { processEmailDomainHealth } from "./email-domain-health";
import {
  processPortalDigest,
  processScheduledNotifications,
} from "./scheduled.js";
import { processIntegrationSync } from "./integrations.js";
import type { BackgroundJobMessage } from "@calibra-facil/schemas";
import { type DeliveryAttempt, type Env } from "./runtime-types.js";
import { processAuditPackJob } from "./audit-pack.js";
import { processDocumentMessage } from "./document-messages.js";

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
    reportWorkerError(error, { jobType: message.type ?? "CERTIFICATE" });
    await flushWorkerErrorReporter();
    throw error;
  }
}

async function processBackgroundJobUnreported(
  env: Env,
  message: BackgroundJobMessage,
  delivery?: DeliveryAttempt,
) {
  if (message.type === "AUDIT_PACK") {
    await processAuditPackJob(env, message);
    return;
  }

  if (message.type === "INTEGRATION_SYNC") {
    await processIntegrationSync(env, message);
    return;
  }

  if (message.type === "SCHEDULED_NOTIFICATIONS") {
    await processScheduledNotifications(env);
    return;
  }

  if (message.type === "PORTAL_DIGEST") {
    await processPortalDigest();
    return;
  }

  if (message.type === "SPC_RECOMPUTE") {
    await processSpcRecompute(env);
    return;
  }

  if (message.type === "EMAIL_DOMAIN_HEALTH") {
    await processEmailDomainHealth();
    return;
  }

  // HTML/label documents render through the hosted Gotenberg service
  // (services/gotenberg) — no in-function Chromium to launch.
  await processDocumentMessage(env, message, delivery);
}
