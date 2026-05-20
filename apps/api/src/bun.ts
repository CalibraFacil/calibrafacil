import app from "./index";

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

type LocalKvValue = {
  value: string;
  expiresAt?: number;
};

type LocalKvNamespace = {
  get(key: string, type?: "text"): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
  delete(key: string): Promise<void>;
};

type BunApiEnv = Record<string, unknown> & {
  CACHE: LocalKvNamespace;
};

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

function createLocalKv(): LocalKvNamespace {
  const values = new Map<string, LocalKvValue>();

  return {
    async get(key) {
      const item = values.get(key);
      if (!item) return null;

      if (item.expiresAt !== undefined && item.expiresAt <= Date.now()) {
        values.delete(key);
        return null;
      }

      return item.value;
    },
    async put(key, value, options) {
      values.set(key, {
        value,
        expiresAt: options?.expirationTtl
          ? Date.now() + options.expirationTtl * 1000
          : undefined,
      });
    },
    async delete(key) {
      values.delete(key);
    },
  };
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
        R2_BUCKET_NAME: "calibrafacil-certificates-dev",
        RESEND_FROM_EMAIL: "Calibra Facil <noreply@calibrafacil.com>",
      };

  const env = {
    ...defaults,
    ...localEnv,
    ...Bun.env,
  } as Record<string, unknown>;

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
      "ASAAS_API_KEY",
      "ASAAS_ENVIRONMENT",
      "ASAAS_WEBHOOK_TOKEN",
      "BACKOFFICE_BOOTSTRAP_TOKEN",
      "INTERNAL_OPERATOR_EMAILS",
      "PUBLIC_API_MASTER_KEY",
      "INTEGRATIONS_MASTER_KEY",
      "SIGNING_MASTER_KEY",
      "PORTAL_SERVICE_USER_ID",
      "R2_ACCOUNT_ID",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
      "R2_BUCKET_NAME",
      "RESEND_API_KEY",
    ]) {
      if (typeof env[key] !== "string" || env[key].length === 0) {
        throw new Error(`${key} is required in production`);
      }
    }
  }

  const apiEnv = env as BunApiEnv;

  apiEnv.CACHE = createLocalKv();

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
  fetch(request) {
    return app.fetch(request, env);
  },
});

console.info(
  `Calibra Facil API listening on http://${server.hostname}:${server.port}`,
);
