import { timingSafeEqual } from "node:crypto";
import { enqueueBackgroundJob } from "../../src/lib/background-jobs";
import {
  processScheduledContaAzulIntegrationSyncs,
  processScheduledContaAzulPolls,
} from "../../src/lib/integrations";
import { processScheduledIntegrationSyncs } from "@calibra-facil/worker/integrations";
import { cleanupExpiredAuthRecords } from "../../src/lib/auth-maintenance";
import { drainOotEmailOutbox } from "../../src/lib/oot-email-drain";
import { drainServiceOrderEmailOutbox } from "../../src/lib/service-order-email-drain";
import { runStaleJobBackstop } from "../../src/lib/stale-job-backstop";
import { createWorkerRuntimeEnv } from "../../src/lib/runtime-env";
import { runCron } from "./cron-run";
import { runCertificateDriftCheck } from "../../src/lib/certificate-drift";
import {
  createR2Client,
  downloadFromR2,
  resolveBucketName,
  type R2Env,
} from "../../src/lib/storage";

// One function serves all Vercel cron jobs so Vercel packages a single bundle
// instead of one per job. The vercel.json crons hit the semantic paths
// /api/cron/{integrations,notifications,portal-digest,auth-maintenance,
// service-order-emails,…}; the dynamic shim api/cron/[job].js
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
    enqueueBackgroundJob(
      { type: "SPC_RECOMPUTE" },
      { idempotencyKey: `spc-recompute-${todayKey()}` },
    ),
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
    enqueueBackgroundJob(
      { type: "EMAIL_DOMAIN_HEALTH" },
      { idempotencyKey: `email-domain-health-${todayKey()}` },
    ),
  );
}

function getDriftR2Env(): R2Env | null {
  const str = (value: unknown) =>
    typeof value === "string" && value !== "" ? value : null;
  const accountId = str(process.env.R2_ACCOUNT_ID);
  const accessKeyId = str(process.env.R2_ACCESS_KEY_ID);
  const secretAccessKey = str(process.env.R2_SECRET_ACCESS_KEY);
  const bucketName = str(process.env.R2_BUCKET_NAME);
  const mediaBucketName = str(process.env.R2_MEDIA_BUCKET_NAME);
  if (
    !accountId ||
    !accessKeyId ||
    !secretAccessKey ||
    !bucketName ||
    !mediaBucketName
  ) {
    return null;
  }
  return {
    R2_ACCOUNT_ID: accountId,
    R2_ACCESS_KEY_ID: accessKeyId,
    R2_SECRET_ACCESS_KEY: secretAccessKey,
    R2_BUCKET_NAME: bucketName,
    R2_MEDIA_BUCKET_NAME: mediaBucketName,
  };
}

// Certificate drift detection: re-hash a sample of
// stored issued-certificate artifacts vs their frozen hashes; mismatches
// become org audit events. Read-only over regulated records.
async function handleCertificateDrift(request: Request) {
  if (!isCronAuthorized(request)) {
    return cronAuthFailureResponse();
  }

  return runCron("certificate-drift", { leaseSeconds: 300 }, () => {
    const r2Env = getDriftR2Env();
    if (!r2Env) {
      console.warn("[drift-check] R2 env unconfigured — skipping");
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
