import { enqueueBackgroundJob } from "../../src/lib/background-jobs";
import {
  processScheduledContaAzulIntegrationSyncs,
  processScheduledContaAzulPolls,
} from "../../src/lib/integrations";
import { processScheduledIntegrationSyncs } from "@calibra-facil/worker/integrations";
import { recomputeOperatorAlerts } from "../../src/lib/operator-alerts";
import { createWorkerRuntimeEnv } from "../../src/lib/runtime-env";

// One function serves all three Vercel cron jobs so Vercel packages a single
// bundle instead of three. The vercel.json crons still hit the semantic paths
// /api/cron/{integrations,notifications,operator-alerts}; the matching dynamic
// shim api/cron/[job].js routes them all here and we dispatch on the trailing
// path segment. Each job keeps the EXACT auth + behavior it had as a standalone
// function — notably, integrations REQUIRES a CRON_SECRET on prod/Vercel
// (503 when unset), while notifications/operator-alerts are lenient (allowed
// when unset). That asymmetry is preserved deliberately, not unified here.

type CronTaskResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

// ── integrations job: CRON_SECRET required on prod/Vercel ─────────────────────
function isCronSecretRequired() {
  return process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);
}

function isIntegrationsAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return !isCronSecretRequired();
  return (
    request.headers.get("authorization") === `Bearer ${secret}` ||
    request.headers.get("x-cron-secret") === secret
  );
}

function getIntegrationsAuthFailureStatus() {
  return process.env.CRON_SECRET ? 401 : 503;
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
  if (!isIntegrationsAuthorized(request)) {
    return Response.json(
      {
        error: process.env.CRON_SECRET
          ? "Unauthorized"
          : "CRON_SECRET não configurado",
      },
      { status: getIntegrationsAuthFailureStatus() },
    );
  }

  const env = createWorkerRuntimeEnv();
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

  return Response.json({ integrationSyncs, contaAzulSyncs, contaAzulPolling });
}

// ── notifications + operator-alerts jobs: lenient auth (allowed when unset) ───
function isLenientAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return (
    request.headers.get("authorization") === `Bearer ${secret}` ||
    request.headers.get("x-cron-secret") === secret
  );
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

async function handleNotifications(request: Request) {
  if (!isLenientAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await enqueueBackgroundJob(
    { type: "SCHEDULED_NOTIFICATIONS" },
    { idempotencyKey: `scheduled-notifications-${todayKey()}` },
  );

  return Response.json(result);
}

async function handleOperatorAlerts(request: Request) {
  if (!isLenientAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await recomputeOperatorAlerts();
  return Response.json(result);
}

const JOB_HANDLERS: Record<string, (request: Request) => Promise<Response>> = {
  integrations: handleIntegrations,
  notifications: handleNotifications,
  "operator-alerts": handleOperatorAlerts,
};

function resolveJob(request: Request) {
  const segments = new URL(request.url).pathname.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? "";
}

export async function GET(request: Request) {
  const job = resolveJob(request);
  const handler = JOB_HANDLERS[job];
  if (!handler) {
    return Response.json({ error: `Unknown cron job: ${job}` }, { status: 404 });
  }
  return handler(request);
}

export default {
  fetch: GET,
};
