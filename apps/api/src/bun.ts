import { resolvePlatformEmailTransport } from "@calibra-facil/email-sender";
import app from "./index";
import { GET as dispatchCron } from "../vercel-src/cron/dispatch";

type BunServer = {
  hostname: string;
  port: number;
};

type BunRuntime = {
  env: Record<string, string | undefined>;
  file(path: URL): {
    exists(): Promise<boolean>;
    text(): Promise<string>;
  };
  serve(options: {
    hostname: string;
    port: number;
    fetch(request: Request): Response | Promise<Response>;
  }): BunServer;
};

declare const Bun: BunRuntime;

type BunApiEnv = Record<string, unknown>;

const appDirectory = new URL("..", import.meta.url);
const isProduction = Bun.env.NODE_ENV === "production";
const localUrlDefaults = {
  API_URL: "http://localhost:3000",
  APP_URL: "http://localhost:5173",
  PORTAL_APP_URL: "http://localhost:5174",
};

function parseLocalEnv(contents: string): Record<string, string> {
  const env: Record<string, string> = {};

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

async function loadLocalEnv() {
  if (isProduction) return {};

  const env: Record<string, string> = {};

  for (const filename of [".env", ".env.local"]) {
    const file = Bun.file(new URL(filename, appDirectory));
    if (await file.exists()) {
      Object.assign(env, parseLocalEnv(await file.text()));
    }
  }

  return env;
}

async function createEnv(): Promise<BunApiEnv> {
  const localEnv = await loadLocalEnv();
  const defaults = isProduction
    ? {
        NODE_ENV: "production",
      }
    : {
        NODE_ENV: Bun.env.NODE_ENV ?? "development",
        ...localUrlDefaults,
        R2_ACCOUNT_ID: "local",
        R2_BUCKET_NAME: "calibrafacil-documents-dev",
        R2_MEDIA_BUCKET_NAME: "calibrafacil-media-dev",
        RESEND_FROM_EMAIL: "Calibra Facil <noreply@example.com>",
      };

  const env: Record<string, unknown> = {
    ...defaults,
    ...localEnv,
    ...Bun.env,
  };

  if (!isProduction) {
    for (const [key, fallback] of Object.entries(localUrlDefaults)) {
      const configuredValue =
        typeof env[key] === "string" ? env[key].trim() : undefined;
      env[key] = configuredValue || fallback;
    }
  }

  const hyperdriveLocalConnectionString =
    env.HYPERDRIVE_LOCAL_CONNECTION_STRING ?? env.DATABASE_URL;

  if (typeof hyperdriveLocalConnectionString === "string") {
    env.DATABASE_URL = hyperdriveLocalConnectionString;
  }

  if (isProduction) {
    for (const key of [
      "DATABASE_URL",
      "BETTER_AUTH_SECRET",
      "PUBLIC_API_MASTER_KEY",
      "INTEGRATIONS_MASTER_KEY",
      "SIGNING_MASTER_KEY",
      "PORTAL_SERVICE_USER_ID",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
      "R2_BUCKET_NAME",
      "R2_MEDIA_BUCKET_NAME",
    ]) {
      if (typeof env[key] !== "string" || env[key].length === 0) {
        throw new Error(`${key} is required in production`);
      }
    }
    if (!env.R2_ACCOUNT_ID && !env.R2_ENDPOINT) {
      throw new Error("R2_ACCOUNT_ID or R2_ENDPOINT is required in production");
    }
    // Sign-in is passwordless, so production cannot run without e-mail.
    if (!resolvePlatformEmailTransport(Bun.env)) {
      throw new Error(
        "E-mail is required in production: set SMTP_HOST (SMTP) or RESEND_API_KEY (Resend)",
      );
    }
  }

  const apiEnv: BunApiEnv = { ...env };

  for (const [key, value] of Object.entries(apiEnv)) {
    if (typeof value === "string") {
      process.env[key] = value;
    }
  }

  return apiEnv;
}

const env = await createEnv();
const port = Number(Bun.env.PORT ?? Bun.env.API_PORT ?? 3000);
const hostname = Bun.env.HOST ?? "0.0.0.0";

const server = Bun.serve({
  hostname,
  port,
  // @ts-expect-error Bun supports idleTimeout, but the bundled type in this workspace has not caught up.
  idleTimeout: 120,
  fetch(request) {
    // On Vercel, /api/cron/* are separate functions triggered by vercel.json.
    // Here (local dev, Docker, any VM) the same handlers are served by this
    // process, so any scheduler can trigger them with the CRON_SECRET bearer
    // token. See DEPLOYMENT.md for the schedule.
    if (new URL(request.url).pathname.startsWith("/api/cron/")) {
      return dispatchCron(request);
    }
    return app.fetch(request, env);
  },
});

console.info(
  `Calibra Facil API listening on http://${server.hostname}:${server.port}`,
);
