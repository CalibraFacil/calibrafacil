import { timingSafeEqual } from "node:crypto";
import { readJobsConfig, readRuntimeConfig } from "@calibra-facil/config";
import { enqueueBackgroundJob } from "../lib/background-jobs";
import {
  processScheduledContaAzulIntegrationSyncs,
  processScheduledContaAzulPolls,
} from "../modules/integrations";
import { processScheduledIntegrationSyncs } from "@calibra-facil/jobs-core/integrations";
import { cleanupExpiredAuthRecords } from "../lib/auth-maintenance";
import { drainOotEmailOutbox } from "../lib/oot-email-drain";
import { drainServiceOrderEmailOutbox } from "../lib/service-order-email-drain";
import { runStaleJobBackstop } from "../lib/stale-job-backstop";
import { createWorkerRuntimeEnv } from "../lib/runtime-env";
import { runCron } from "./cron-run";
import { runCertificateDriftCheck } from "../lib/certificate-drift";
import { runRecordsPurge } from "../lib/records-purge";
import { purgeSyncChangeLog } from "../lib/sync-change-log-purge";
import { reconcileApprovalEffects } from "../lib/approval-effects-reconciler";
import {
  createR2Client,
  downloadFromR2,
  r2EnvForStorageDependentWork,
  resolveBucketName,
} from "../lib/storage";

// One dispatcher serves every cron job. The scheduler (the in-process one,
// lib/cron-scheduler.ts, or an external one) hits the semantic paths
// /api/cron/{integrations,notifications,portal-digest,auth-maintenance,
// service-order-emails,…} and we dispatch on the trailing path segment. (The
// cron-scheduler spec asserts the scheduled paths <-> JOB_HANDLERS stay in
// sync.)
//
// Auth is uniform and fail-closed: in production a CRON_SECRET is REQUIRED for
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
  const runtime = readRuntimeConfig();
  return runtime.nodeEnv === "production";
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
  const secret = readJobsConfig().cronSecret;
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
  const secretConfigured = Boolean(readJobsConfig().cronSecret);
  return Response.json(
    {
      error: secretConfigured ? "Unauthorized" : "CRON_SECRET não configurado",
    },
    { status: secretConfigured ? 401 : 503 },
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
          await enqueueBackgroundJob(message);
        },
      }),
    );
    const contaAzulSyncs = await runCronTask("conta_azul_syncs", () =>
      processScheduledContaAzulIntegrationSyncs({
        env,
        dispatch: async (message) => {
          await enqueueBackgroundJob(message);
        },
      }),
    );
    const contaAzulPolling = await runCronTask("conta_azul_polling", () =>
      processScheduledContaAzulPolls({ env }),
    );

    return { integrationSyncs, contaAzulSyncs, contaAzulPolling };
  });
}

async function handleNotifications(request: Request) {
  if (!isCronAuthorized(request)) {
    return cronAuthFailureResponse();
  }

  return runCron("notifications", { leaseSeconds: 120 }, () =>
    enqueueBackgroundJob({ type: "SCHEDULED_NOTIFICATIONS" }),
  );
}

async function handlePortalDigest(request: Request) {
  if (!isCronAuthorized(request)) {
    return cronAuthFailureResponse();
  }

  return runCron("portal-digest", { leaseSeconds: 120 }, () =>
    enqueueBackgroundJob({ type: "PORTAL_DIGEST" }),
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

// §7.10 out-of-tolerance notification emails (#426 Phase 0): drains
// oot_email_outbox, attaching the generated notification PDF.
async function handleOotEmails(request: Request) {
  if (!isCronAuthorized(request)) {
    return cronAuthFailureResponse();
  }

  return runCron("oot-emails", { leaseSeconds: 120 }, () =>
    drainOotEmailOutbox(),
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

// §7.7.1 SPC nightly sweep (issue #60): re-evaluates every control chart
// against its stored check-standard readings so trend/out-of-control statuses
// stay current even when no new reading is recorded.
async function handleSpcRecompute(request: Request) {
  if (!isCronAuthorized(request)) {
    return cronAuthFailureResponse();
  }

  return runCron("spc-recompute", { leaseSeconds: 120 }, () =>
    enqueueBackgroundJob({ type: "SPC_RECOMPUTE" }),
  );
}

// #584 P4: daily re-poll of every lab-owned email sending domain via the
// lab's own Resend key — refreshes domain verification status and key health
// so lapses surface in settings before a send has to fall back.
async function handleEmailDomainHealth(request: Request) {
  if (!isCronAuthorized(request)) {
    return cronAuthFailureResponse();
  }

  return runCron("email-domain-health", { leaseSeconds: 120 }, () =>
    enqueueBackgroundJob({ type: "EMAIL_DOMAIN_HEALTH" }),
  );
}

// Certificate drift detection: re-hash a sample of
// stored issued-certificate artifacts vs their frozen hashes; mismatches
// become org audit events. Read-only over regulated records.
async function handleCertificateDrift(request: Request) {
  if (!isCronAuthorized(request)) {
    return cronAuthFailureResponse();
  }

  return runCron("certificate-drift", { leaseSeconds: 300 }, () => {
    // Production without storage throws (the run is recorded as failed): a drift
    // check that reports "checked: 0" is indistinguishable from a clean one.
    const r2Env = r2EnvForStorageDependentWork(
      "run the certificate drift check",
    );
    if (!r2Env) {
      console.warn("[drift-check] storage unconfigured — skipping");
      return Promise.resolve({
        checked: 0,
        drifted: 0,
        missing: 0,
        details: [],
      });
    }
    const client = createR2Client(r2Env);
    return runCertificateDriftCheck(async (_bucket, key) => {
      try {
        const bytes = await downloadFromR2(
          client,
          resolveBucketName(r2Env, "documents"),
          key,
        );
        return bytes ?? null;
      } catch {
        return null;
      }
    });
  });
}

// Retention of regulated records (decision Q16): purge of soft-deleted
// organizations whose newest evidence is past retention. Registered but OFF:
// RECORDS_PURGE_ENABLED must be "true" to do anything, and even then it only
// logs what it would purge unless RECORDS_PURGE_MODE=execute (DEPLOYMENT.md).
async function handleRecordsPurge(request: Request) {
  if (!isCronAuthorized(request)) {
    return cronAuthFailureResponse();
  }

  return runCron("records-purge", { leaseSeconds: 300 }, () =>
    runRecordsPurge(),
  );
}

// Retention of the desktop change log (SYNC_CHANGE_LOG_RETENTION_DAYS, default 90): a
// desktop whose cursor is older than what was purged is told to bootstrap again.
async function handleSyncChangeLogPurge(request: Request) {
  if (!isCronAuthorized(request)) {
    return cronAuthFailureResponse();
  }

  return runCron("sync-change-log-purge", { leaseSeconds: 300 }, () =>
    purgeSyncChangeLog(),
  );
}

// Roadmap 2 B2 (ISO/IEC 17025 7.10): nightly repair of the post-approval effects
// that can still be missing: the asset out-of-tolerance event, the asset
// calibration-date advance and the customer alert (approvals that predate the
// transactional write, notification jobs the queue gave up on). Idempotent; see
// lib/approval-effects-reconciler.ts.
async function handleApprovalEffectsReconcile(request: Request) {
  if (!isCronAuthorized(request)) {
    return cronAuthFailureResponse();
  }

  return runCron("approval-effects-reconcile", { leaseSeconds: 600 }, () =>
    reconcileApprovalEffects(),
  );
}

export const JOB_HANDLERS: Record<
  string,
  (request: Request) => Promise<Response>
> = {
  integrations: handleIntegrations,
  notifications: handleNotifications,
  "portal-digest": handlePortalDigest,
  "auth-maintenance": handleAuthMaintenance,
  "service-order-emails": handleServiceOrderEmails,
  "oot-emails": handleOotEmails,
  "queue-backstop": handleQueueBackstop,
  "spc-recompute": handleSpcRecompute,
  "email-domain-health": handleEmailDomainHealth,
  "certificate-drift": handleCertificateDrift,
  "records-purge": handleRecordsPurge,
  "sync-change-log-purge": handleSyncChangeLogPurge,
  "approval-effects-reconcile": handleApprovalEffectsReconcile,
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
