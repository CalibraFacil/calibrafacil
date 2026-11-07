import { timingSafeEqual } from "node:crypto";
import { readJobsConfig, readRuntimeConfig } from "@calibra-facil/config";
import { enqueueBackgroundJob } from "../lib/background-jobs";
import {
  dispatchContaAzulSync,
  processScheduledContaAzulIntegrationSyncs,
  processScheduledContaAzulPolls,
} from "../modules/integrations";
import { processScheduledIntegrationSyncs } from "@calibra-facil/jobs-core/integrations";
import { cleanupExpiredAuthRecords } from "../lib/auth-maintenance";
import { drainOotEmailOutbox } from "../lib/oot-email-drain";
import { drainServiceOrderEmailOutbox } from "../domains/service-orders";
import { runStaleJobBackstop } from "../lib/stale-job-backstop";
import { createWorkerRuntimeEnv } from "../lib/runtime-env";
import { runCron } from "./cron-run";
import { CRON_SCHEDULE, isCronJobName, type CronJobName } from "./schedule";
import { runCertificateDriftCheck } from "../lib/certificate-drift";
import { runRecordsPurge } from "../lib/records-purge";
import { runAuditChainVerification } from "../lib/audit-chain";
import { purgeSyncChangeLog } from "../domains/sync";
import { reconcileApprovalEffects } from "../lib/approval-effects-reconciler";
import {
  createR2Client,
  downloadFromR2,
  r2EnvForStorageDependentWork,
  resolveBucketName,
} from "../lib/storage";

// One dispatcher serves every cron job. The scheduler (the in-process one,
// lib/cron-scheduler.ts, or an external one) hits the semantic paths
// /api/cron/<job> (the names of src/cron/schedule.ts) and we dispatch on the
// trailing path segment.
//
// Auth is uniform and fail-closed: in production a CRON_SECRET is REQUIRED for
// every job (503 when unset), secrets are compared in constant time, and the
// check runs BEFORE any work. Each authorized request then runs its task under
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

async function runIntegrations() {
  const env = createWorkerRuntimeEnv();
  // Each sub-task is isolated by runCronTask so one failing provider never
  // aborts the others; the run still reports 200 with the per-task breakdown.
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
        await dispatchContaAzulSync(message);
      },
    }),
  );
  const contaAzulPolling = await runCronTask("conta_azul_polling", () =>
    processScheduledContaAzulPolls({ env }),
  );

  return { integrationSyncs, contaAzulSyncs, contaAzulPolling };
}

/**
 * Re-hash a sample of stored issued-certificate artifacts against their frozen
 * hashes; mismatches become organization audit events. Read-only over
 * regulated records.
 */
function runCertificateDrift() {
  // Production without storage throws (the run is recorded as failed): a drift
  // check that reports "checked: 0" is indistinguishable from a clean one.
  const r2Env = r2EnvForStorageDependentWork("run the certificate drift check");
  if (!r2Env) {
    console.warn("[drift-check] storage unconfigured — skipping");
    return Promise.resolve({ checked: 0, drifted: 0, missing: 0, details: [] });
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
}

type CronTask = {
  run: () => Promise<unknown>;
  /** A run that returns this result is recorded as failed although it did not throw. */
  failed?: (result: unknown) => boolean;
};

/** What each scheduled job (src/cron/schedule.ts) runs. */
const CRON_TASKS = {
  integrations: { run: runIntegrations },
  notifications: {
    run: () => enqueueBackgroundJob({ type: "SCHEDULED_NOTIFICATIONS" }),
  },
  "portal-digest": {
    run: () => enqueueBackgroundJob({ type: "PORTAL_DIGEST" }),
  },
  "auth-maintenance": { run: cleanupExpiredAuthRecords },
  "service-order-emails": { run: drainServiceOrderEmailOutbox },
  // §7.10 out-of-tolerance notification e-mails, with the generated PDF attached.
  "oot-emails": { run: drainOotEmailOutbox },
  // Reclaims expired app_queue_job leases and re-drives the drain, so a render
  // stuck past its lease is recovered even when no new job is enqueued.
  "queue-backstop": { run: runStaleJobBackstop },
  // §7.7.1: re-evaluates every control chart so trend/out-of-control statuses
  // stay current when no new reading arrives.
  "spc-recompute": {
    run: () => enqueueBackgroundJob({ type: "SPC_RECOMPUTE" }),
  },
  // Re-polls every lab-owned sending domain through the lab's own Resend key.
  "email-domain-health": {
    run: () => enqueueBackgroundJob({ type: "EMAIL_DOMAIN_HEALTH" }),
  },
  "certificate-drift": { run: runCertificateDrift },
  // Retention of regulated records (decision Q16). Off unless
  // RECORDS_PURGE_ENABLED=true, and a dry run unless RECORDS_PURGE_MODE=execute.
  "records-purge": { run: runRecordsPurge },
  // A desktop whose cursor is older than what was purged bootstraps again.
  "sync-change-log-purge": { run: purgeSyncChangeLog },
  // ISO/IEC 17025 7.10: repairs post-approval effects that can still be missing
  // (asset OOT event, calibration-date advance, customer alert). Idempotent.
  "approval-effects-reconcile": {
    run: reconcileApprovalEffects,
    failed: (result) =>
      typeof result === "object" &&
      result !== null &&
      Number(Reflect.get(result, "failures")) > 0,
  },
  // Tamper evidence: recomputes each organization's job_audit_log hash chain; a
  // broken chain fails the run until a human resolves it. Nothing is repaired.
  "audit-chain-verify": { run: runAuditChainVerification },
} satisfies Record<CronJobName, CronTask>;

function resolveJob(request: Request) {
  const segments = new URL(request.url).pathname.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? "";
}

export async function GET(request: Request) {
  const job = resolveJob(request);
  if (!isCronJobName(job)) {
    return Response.json(
      { error: `Unknown cron job: ${job}` },
      { status: 404 },
    );
  }
  if (!isCronAuthorized(request)) {
    return cronAuthFailureResponse();
  }
  const task: CronTask = CRON_TASKS[job];
  // runCron catches task failures; anything thrown before that must still
  // become a structured 500, never an uncaught rejection.
  try {
    return await runCron(
      job,
      { leaseSeconds: CRON_SCHEDULE[job].leaseSeconds, failed: task.failed },
      task.run,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erro desconhecido no cron";
    console.error("[Cron] handler crashed", { job, message });
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
