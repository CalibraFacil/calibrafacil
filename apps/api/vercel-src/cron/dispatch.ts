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
import { createWorkerRuntimeEnv } from "../../src/lib/runtime-env";

// One function serves all Vercel cron jobs so Vercel packages a single bundle
// instead of one per job. The vercel.json crons still hit the semantic paths
// /api/cron/{integrations,notifications,portal-digest,operator-alerts,auth-maintenance};
// the matching dynamic shim api/cron/[job].js routes them all here and we
// dispatch on the trailing path segment. Auth is uniform and fail-closed: on
// prod/Vercel a CRON_SECRET is REQUIRED for every job (503 when unset), and
// secrets are compared in constant time. Local dev without a secret stays
// open so the endpoints remain curl-able.

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

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

async function handleNotifications(request: Request) {
  if (!isCronAuthorized(request)) {
    return cronAuthFailureResponse();
  }

  const result = await enqueueBackgroundJob(
    { type: "SCHEDULED_NOTIFICATIONS" },
    { idempotencyKey: `scheduled-notifications-${todayKey()}` },
  );

  return Response.json(result);
}

async function handlePortalDigest(request: Request) {
  if (!isCronAuthorized(request)) {
    return cronAuthFailureResponse();
  }

  const result = await enqueueBackgroundJob(
    { type: "PORTAL_DIGEST" },
    { idempotencyKey: `portal-digest-${todayKey()}` },
  );

  return Response.json(result);
}

async function handleOperatorAlerts(request: Request) {
  if (!isCronAuthorized(request)) {
    return cronAuthFailureResponse();
  }

  const result = await recomputeOperatorAlerts();
  return Response.json(result);
}

async function handleAuthMaintenance(request: Request) {
  if (!isCronAuthorized(request)) {
    return cronAuthFailureResponse();
  }

  const result = await cleanupExpiredAuthRecords();
  return Response.json(result);
}

async function handleServiceOrderEmails(request: Request) {
  if (!isCronAuthorized(request)) {
    return cronAuthFailureResponse();
  }

  const result = await drainServiceOrderEmailOutbox();
  return Response.json(result);
}

const JOB_HANDLERS: Record<string, (request: Request) => Promise<Response>> = {
  integrations: handleIntegrations,
  notifications: handleNotifications,
  "portal-digest": handlePortalDigest,
  "operator-alerts": handleOperatorAlerts,
  "auth-maintenance": handleAuthMaintenance,
  "service-order-emails": handleServiceOrderEmails,
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
  return handler(request);
}

export default {
  fetch: GET,
};
