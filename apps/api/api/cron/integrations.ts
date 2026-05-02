import { enqueueBackgroundJob } from "../../src/lib/background-jobs";
import { createWorkerRuntimeEnv } from "../../src/lib/runtime-env";
import { importWorkerIntegrationsModule } from "../../src/lib/worker-modules";

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return (
    request.headers.get("authorization") === `Bearer ${secret}` ||
    request.headers.get("x-cron-secret") === secret
  );
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const env = createWorkerRuntimeEnv();
  const { processScheduledIntegrationSyncs } =
    await importWorkerIntegrationsModule();
  const result = await processScheduledIntegrationSyncs(env, {
    dispatch: async (message) => {
      await enqueueBackgroundJob(message, {
        idempotencyKey: `integration-sync-${message.runId}`,
      });
    },
  });

  return Response.json(result);
}

export default {
  fetch: GET,
};
