import { Container, getContainer } from "@cloudflare/containers";
import type { DurableObject } from "cloudflare:workers";

/**
 * Runtime configuration forwarded to the container process. Secrets
 * (DATABASE_URL, R2 keys, signing/integration master keys, …) are set with
 * `wrangler secret put`; non-secret tuning comes from `vars` in wrangler.jsonc.
 * Either way they arrive on the Worker `env` and we forward them to the
 * container via `envVars` (Cloudflare does not inject Worker secrets into a
 * container automatically).
 */
const CONTAINER_ENV_KEYS = [
  "DATABASE_URL",
  "R2_ACCOUNT_ID",
  "R2_BUCKET_NAME",
  "R2_MEDIA_BUCKET_NAME",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "GOTENBERG_URL",
  "GOTENBERG_TOKEN",
  "SIGNING_MASTER_KEY",
  "INTEGRATIONS_MASTER_KEY",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "EMAIL_FROM",
  "EMAIL_LOGO_URL",
  "WEB_URL",
  "APP_URL",
  "WORKER_ID",
  "PORT",
  "NODE_ENV",
  "QUEUE_BATCH_SIZE",
  "QUEUE_STALE_AFTER_MS",
] satisfies (keyof Env)[];

interface Env {
  DOCUMENT_WORKER_CONTAINER: DurableObjectNamespace<DocumentWorkerContainer>;
  // Shared secret the API must send as X-Worker-Token to reach POST /drain.
  // Set via `wrangler secret put DOCUMENT_WORKER_TOKEN`.
  DOCUMENT_WORKER_TOKEN?: string;
  // Forwarded to the container (see CONTAINER_ENV_KEYS).
  DATABASE_URL?: string;
  R2_ACCOUNT_ID?: string;
  R2_BUCKET_NAME?: string;
  R2_MEDIA_BUCKET_NAME?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  GOTENBERG_URL?: string;
  GOTENBERG_TOKEN?: string;
  SIGNING_MASTER_KEY?: string;
  INTEGRATIONS_MASTER_KEY?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  EMAIL_FROM?: string;
  EMAIL_LOGO_URL?: string;
  WEB_URL?: string;
  APP_URL?: string;
  WORKER_ID?: string;
  PORT?: string;
  NODE_ENV?: string;
  QUEUE_BATCH_SIZE?: string;
  QUEUE_STALE_AFTER_MS?: string;
}

function buildContainerEnv(env: Env): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of CONTAINER_ENV_KEYS) {
    const value = env[key];
    if (typeof value === "string" && value.length > 0) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * The container runs apps/worker/src/serve.ts (an HTTP drain server). It is
 * woken by a request, drains the `app_queue_job` queue to empty, then sits
 * idle until Cloudflare scales it back to zero — so the database is never
 * polled while there is no work.
 */
export class DocumentWorkerContainer extends Container<Env> {
  defaultPort = 8080;
  // Scale to zero after 15 minutes idle; the next /drain cold-starts it.
  sleepAfter = "15m";

  constructor(ctx: DurableObject["ctx"], env: Env) {
    super(ctx, env);
    this.envVars = buildContainerEnv(env);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Liveness for monitoring — answered at the edge so it does NOT wake the
    // container (a frequent health check must not defeat scale-to-zero).
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true });
    }

    // Everything else requires the shared secret and is forwarded to the
    // container. The container is only reachable through this Worker, so a
    // single auth gate here is sufficient (mirrors services/gotenberg).
    const expected = env.DOCUMENT_WORKER_TOKEN;
    if (!expected || request.headers.get("X-Worker-Token") !== expected) {
      return new Response("Unauthorized\n", { status: 401 });
    }

    const container = getContainer(env.DOCUMENT_WORKER_CONTAINER, "singleton");
    return container.fetch(request);
  },
};
