import { enqueueBackgroundJob } from "../../src/lib/background-jobs";
import {
  processScheduledContaAzulIntegrationSyncs,
  processScheduledContaAzulPolls,
} from "../../src/lib/integrations";
import { processScheduledIntegrationSyncs } from "@calibra-facil/worker/integrations";
import { createWorkerRuntimeEnv } from "../../src/lib/runtime-env";

type CronTaskResult<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      error: string;
      ok: false;
    };

function isCronSecretRequired() {
  return process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);
}

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return !isCronSecretRequired();
  return (
    request.headers.get("authorization") === `Bearer ${secret}` ||
    request.headers.get("x-cron-secret") === secret
  );
}

function getCronAuthFailureStatus() {
  return process.env.CRON_SECRET ? 401 : 503;
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

async function runCronTask<T>(
  name: string,
  task: () => Promise<T>,
): Promise<CronTaskResult<T>> {
  try {
    return {
      ok: true,
      value: await task(),
    };
  } catch (error) {
    const message = getErrorMessage(error, "Falha ao processar tarefa do cron");
    console.error("[IntegrationsCron] Task failed", {
      name,
      message,
    });
    return {
      error: message,
      ok: false,
    };
  }
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json(
      {
        error: process.env.CRON_SECRET
          ? "Unauthorized"
          : "CRON_SECRET não configurado",
      },
      { status: getCronAuthFailureStatus() },
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
    processScheduledContaAzulPolls({
      env,
    }),
  );

  return Response.json({
    integrationSyncs,
    contaAzulSyncs,
    contaAzulPolling,
  });
}

export default {
  fetch: GET,
};
