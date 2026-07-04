import { timingSafeEqual } from "node:crypto";
import { enqueueBackgroundJob } from "../../src/lib/background-jobs";
import {
  processScheduledContaAzulIntegrationSyncs,
  processScheduledContaAzulPolls,
} from "../../src/lib/integrations";
import { processScheduledIntegrationSyncs } from "@calibra-facil/worker/integrations";
import { cleanupExpiredAuthRecords } from "../../src/lib/auth-maintenance";
import { recomputeOperatorAlerts } from "../../src/lib/operator-alerts";
import { drainServiceOrderEmailOutbox } from "../../src/lib/service-order-email-drain";
import { runStaleJobBackstop } from "../../src/lib/stale-job-backstop";
import {
  createAsaasReconciliationPort,
  reconcileProviderSubscriptions,
} from "../../src/services/commercial/reconcile-subscriptions";
import { createWorkerRuntimeEnv } from "../../src/lib/runtime-env";
import { runCron } from "./cron-run";

// One function serves all Vercel cron jobs so Vercel packages a single bundle
// instead of one per job. The vercel.json crons hit the semantic paths
// /api/cron/{integrations,notifications,portal-digest,operator-alerts,
// auth-maintenance,service-order-emails}; the dynamic shim api/cron/[job].js
// routes them all here and we dispatch on the trailing path segment. (The
// cron-routing-parity test asserts these paths <-> JOB_HANDLERS stay in sync
// and that no vercel.json rewrite swallows them into the Hono app.)
//
// Auth is uniform and fail-closed: on prod/Vercel a CRON_SECRET is REQUIRED for
// every job (503 when unset), secrets are compared in constant time, and the
// check runs BEFORE any work. Each authorized handler then runs its task under
// runCron(), which adds a lease (no overlapping runs), a heartbeat (cron_run
// table, so a silently-broken cron is detectable), and turns any throw into a
// structured 500. Local dev without a secret stays open so endpoints are
// curl-able.

type CronTaskResult<T> = { ok: true; value: T } | { ok: false; error: string };

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function isCronSecretRequired() {
  return process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);
}

function secretsEqual(expected: string, received: string | null) {
  if (received === null) {
    return false;
  }

  const expectedBytes = Buffer.from(expected, "utf8");
  const receivedBytes = Buffer.from(received, "utf8");

  if (expectedBytes.length !== receivedBytes.length) {
    return false;
  }

  return timingSafeEqual(expectedBytes, receivedBytes);
}

function isCronAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return !isCronSecretRequired();

  const authorization = request.headers.get("authorization");
  const bearerToken = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : null;

  return (
    secretsEqual(secret, bearerToken) ||
    secretsEqual(secret, request.headers.get("x-cron-secret"))
  );
}

function cronAuthFailureResponse() {
  return Response.json(
    {
      error: process.env.CRON_SECRET
        ? "Unauthorized"
        : "CRON_SECRET não configurado",
    },
    { status: process.env.CRON_SECRET ? 401 : 503 },
  );
}

async function runCronTask<T>(
  name: string,
  task: () => Promise<T>,
): Promise<CronTaskResult<T>> {
  try {
    return { ok: true, value: await task() };
  } catch (error) {
    const message = getErrorMessage(error, "Falha ao processar tarefa do cron");
    console.error("[IntegrationsCron] Task failed", { name, message });
    return { ok: false, error: message };
  }
}

async function handleIntegrations(request: Request) {
  if (!isCronAuthorized(request)) {
    return cronAuthFailureResponse();
  }

  return runCron("integrations", { leaseSeconds: 120 }, async () => {
    const env = createWorkerRuntimeEnv();
    // Each sub-task is independently isolated via runCronTask so one failing
    // provider never aborts the others; the run still reports 200 with the
    // per-task ok/error breakdown.
    const integrationSyncs = await runCronTask("generic_http_syncs", () =>
      processScheduledIntegrationSyncs(env, {
        dispatch: async (message) => {
          await enqueueBackgroundJob(message, {
            idempotencyKey: `integration-sync-${message.runId}`,
          });
        },
      }),
    );
    const contaAzulSyncs = await runCronTask("conta_azul_syncs", () =>
      processScheduledContaAzulIntegrationSyncs({
        env,
        dispatch: async (message) => {
          await enqueueBackgroundJob(message, {
            idempotencyKey: `conta-azul-sync-${message.runId}`,
          });
        },
      }),
    );
    const contaAzulPolling = await runCronTask("conta_azul_polling", () =>
      processScheduledContaAzulPolls({ env }),
    );

    return { integrationSyncs, contaAzulSyncs, contaAzulPolling };
  });
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

async function handleNotifications(request: Request) {
  if (!isCronAuthorized(request)) {
    return cronAuthFailureResponse();
  }

  return runCron("notifications", { leaseSeconds: 120 }, () =>
    enqueueBackgroundJob(
      { type: "SCHEDULED_NOTIFICATIONS" },
      { idempotencyKey: `scheduled-notifications-${todayKey()}` },
    ),
  );
}

async function handlePortalDigest(request: Request) {
  if (!isCronAuthorized(request)) {
    return cronAuthFailureResponse();
  }

  return runCron("portal-digest", { leaseSeconds: 120 }, () =>
    enqueueBackgroundJob(
      { type: "PORTAL_DIGEST" },
      { idempotencyKey: `portal-digest-${todayKey()}` },
    ),
  );
}

async function handleMarketingContactSync(request: Request) {
  if (!isCronAuthorized(request)) {
    return cronAuthFailureResponse();
  }

  return runCron("marketing-contact-sync", { leaseSeconds: 120 }, () =>
    enqueueBackgroundJob(
      { type: "MARKETING_CONTACT_SYNC" },
      { idempotencyKey: `marketing-contact-sync-${todayKey()}` },
    ),
  );
}

async function handleOperatorAlerts(request: Request) {
  if (!isCronAuthorized(request)) {
    return cronAuthFailureResponse();
  }

  return runCron("operator-alerts", { leaseSeconds: 120 }, () =>
    recomputeOperatorAlerts(),
  );
}

async function handleAuthMaintenance(request: Request) {
  if (!isCronAuthorized(request)) {
    return cronAuthFailureResponse();
  }

  return runCron("auth-maintenance", { leaseSeconds: 120 }, () =>
    cleanupExpiredAuthRecords(),
  );
}

async function handleServiceOrderEmails(request: Request) {
  if (!isCronAuthorized(request)) {
    return cronAuthFailureResponse();
  }

  return runCron("service-order-emails", { leaseSeconds: 120 }, () =>
    drainServiceOrderEmailOutbox(),
  );
}

// REL-03 backstop (#652): reclaim expired app_queue_job leases and re-drive the
// document-worker drain on a timer, so a render job stuck in GENERATING_PDF /
// PENDING past its lease is recovered even when no new job is enqueued. Scheduled
// at */30 (same window as the other reliability crons) so it piggybacks their
// Neon wake instead of adding a new one.
async function handleQueueBackstop(request: Request) {
  if (!isCronAuthorized(request)) {
    return cronAuthFailureResponse();
  }

  return runCron("queue-backstop", { leaseSeconds: 120 }, () =>
    runStaleJobBackstop(),
  );
}

async function handleSubscriptionReconciliation(request: Request) {
  if (!isCronAuthorized(request)) {
    return cronAuthFailureResponse();
  }

  // Backstop for lost/never-retried ASAAS webhooks: reconcile local subscription
  // state against the provider and correct/alert on divergence (REQ-REL-ASA-002).
  return runCron("subscription-reconciliation", { leaseSeconds: 120 }, () =>
    reconcileProviderSubscriptions(createAsaasReconciliationPort()),
  );
}

export const JOB_HANDLERS: Record<
  string,
  (request: Request) => Promise<Response>
> = {
  integrations: handleIntegrations,
  notifications: handleNotifications,
  "portal-digest": handlePortalDigest,
  "marketing-contact-sync": handleMarketingContactSync,
  "operator-alerts": handleOperatorAlerts,
  "auth-maintenance": handleAuthMaintenance,
  "service-order-emails": handleServiceOrderEmails,
  "queue-backstop": handleQueueBackstop,
  "subscription-reconciliation": handleSubscriptionReconciliation,
};

function resolveJob(request: Request) {
  const segments = new URL(request.url).pathname.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? "";
}

export async function GET(request: Request) {
  const job = resolveJob(request);
  const handler = JOB_HANDLERS[job];
  if (!handler) {
    return Response.json(
      { error: `Unknown cron job: ${job}` },
      { status: 404 },
    );
  }
  // Last-resort guard: handlers already run their work under runCron (which
  // catches task failures), but anything thrown before that — auth parsing, an
  // import-time error — must still become a structured 500, never an uncaught
  // rejection that 500s with a bare stack.
  try {
    return await handler(request);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erro desconhecido no cron";
    console.error("[Cron] handler crashed", { job, message });
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

export default {
  fetch: GET,
};
