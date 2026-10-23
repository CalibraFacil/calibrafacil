import { describe, expect, it } from "vitest";
import {
  ConfigError,
  loadApiConfig,
  loadLocalServerConfig,
  loadPortalConfig,
  loadWebConfig,
  loadWorkerConfig,
  readDatabaseConfig,
  readJobsConfig,
  readRetentionConfig,
  readSyncConfig,
} from "./index";

const SECRET_SENTINEL = "s3cr3t-sentinel-value-0123456789";

/** Every value a production API needs, with throwaway values. */
function productionEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  const key = Buffer.alloc(32, 7).toString("base64");
  return {
    NODE_ENV: "production",
    DATABASE_URL: "postgres://user:pass@db.internal:5432/calibra",
    API_URL: "https://calibra.example.com",
    APP_URL: "https://calibra.example.com",
    PORTAL_APP_URL: "https://portal.example.com",
    BETTER_AUTH_SECRET: "a".repeat(48),
    PORTAL_SERVICE_USER_ID: "portal-service",
    R2_ENDPOINT: "http://s3:7070",
    R2_ACCESS_KEY_ID: "calibra",
    R2_SECRET_ACCESS_KEY: "calibra-secret",
    R2_BUCKET_NAME: "calibra-documents",
    R2_MEDIA_BUCKET_NAME: "calibra-media",
    SMTP_HOST: "mail.example.com",
    CRON_SECRET: "cron-secret",
    SIGNING_MASTER_KEY: key,
    INTEGRATIONS_MASTER_KEY: key,
    PUBLIC_API_MASTER_KEY: key,
    QUOTE_APPROVAL_CODE_PEPPER: "pepper",
    ...overrides,
  };
}

function loadFailure(load: () => unknown): ConfigError {
  try {
    load();
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error("expected the loader to throw a ConfigError");
}

describe("REQ-CFG-1 defaults", () => {
  it("REQ-CFG-1: an empty development environment loads with safe defaults", () => {
    const config = loadApiConfig({});

    expect(config.runtime.nodeEnv).toBe("development");
    expect(config.runtime.isProduction).toBe(false);
    expect(config.runtime.host).toBe("0.0.0.0");
    expect(config.database.poolMax).toBe(5);
    expect(config.jobs.mode).toBe("local");
    expect(config.jobs.maxDeliveries).toBe(3);
    expect(config.jobs.queueReceiptsMode).toBe("enforce");
    expect(config.jobs.documentWorkerWakeTimeoutMs).toBe(12_000);
    expect(config.retention.purgeEnabled).toBe(false);
    expect(config.retention.purgeMode).toBe("dry-run");
    expect(config.auth.publicSignupEnabled).toBe(false);
    expect(config.signing.tsaIcpConformant).toBe(false);
    expect(config.email.transport).toBeNull();
  });

  it("REQ-CFG-1: blank values count as unset and surrounding whitespace is trimmed", () => {
    const config = loadApiConfig({
      DATABASE_URL: "   ",
      DATABASE_POOL_MAX: "",
      APP_URL: "  http://localhost:5173  ",
    });

    expect(config.database.url).toBeUndefined();
    expect(config.database.poolMax).toBe(5);
    expect(config.origins.appUrl).toBe("http://localhost:5173");
  });

  it("REQ-CFG-1: the pool defaults to a single connection on Vercel", () => {
    expect(readDatabaseConfig({ VERCEL: "1" }).poolMax).toBe(1);
    expect(
      readDatabaseConfig({ VERCEL: "1", DATABASE_POOL_MAX: "4" }).poolMax,
    ).toBe(4);
  });

  it("REQ-RLS-2: DATABASE_RLS_MODE is `shadow` unless the role split switched it to `enforced`", () => {
    expect(readDatabaseConfig({}).rlsMode).toBe("shadow");
    expect(readDatabaseConfig({ DATABASE_RLS_MODE: "enforced" }).rlsMode).toBe(
      "enforced",
    );
    expect(
      readDatabaseConfig({ DATABASE_RLS_MODE: " Enforced " }).rlsMode,
    ).toBe("enforced");
    expect(() => readDatabaseConfig({ DATABASE_RLS_MODE: "on" })).toThrow(
      /DATABASE_RLS_MODE/,
    );
  });

  it("REQ-CFG-1: the jobs mode follows the platform unless set", () => {
    expect(readJobsConfig({ VERCEL: "1" }).mode).toBe("vercel");
    expect(
      readJobsConfig({ VERCEL: "1", BACKGROUND_JOBS_MODE: "queue" }).mode,
    ).toBe("queue");
  });

  it("REQ-CFG-1: returns a deeply frozen object", () => {
    const config = loadApiConfig({ DATABASE_URL: "postgres://a/b" });

    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.database)).toBe(true);
    expect(Object.isFrozen(config.origins.corsAllowedOrigins)).toBe(true);
    expect(() => {
      Reflect.set(config.database, "DATABASE_URL", "changed");
    }).not.toThrow();
    expect(config.database.url).toBe("postgres://a/b");
  });

  it("REQ-CFG-1: comma-separated lists are split, trimmed and cleaned", () => {
    const config = loadApiConfig({
      CORS_ALLOWED_ORIGINS: " https://a.example , ,https://b.example ",
    });
    expect(config.origins.corsAllowedOrigins).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
  });

  it("REQ-CFG-1: tolerant safety switches fall back instead of failing", () => {
    const config = loadApiConfig({
      QUEUE_RECEIPTS_MODE: "strict",
      RECORDS_PURGE_ENABLED: "yes",
      RECORDS_PURGE_MODE: "x",
      BACKGROUND_JOBS_MAX_DELIVERIES: "abc",
      STUCK_RENDER_AFTER_MS: "soon",
      QUEUE_STALE_AFTER_MS: "0",
    });
    expect(config.jobs.stuckRenderAfterMs).toBe(3_600_000);
    expect(config.jobs.queueStaleAfterMs).toBe(600_000);
    expect(config.jobs.queueReceiptsMode).toBe("enforce");
    expect(config.retention.purgeEnabled).toBe(false);
    expect(config.retention.purgeMode).toBe("dry-run");
    expect(config.jobs.maxDeliveries).toBe(3);

    expect(
      readJobsConfig({ QUEUE_RECEIPTS_MODE: " OFF " }).queueReceiptsMode,
    ).toBe("off");
    expect(
      readRetentionConfig({
        RECORDS_PURGE_ENABLED: " TRUE ",
        RECORDS_PURGE_MODE: "Execute",
      }),
    ).toMatchObject({ purgeEnabled: true, purgeMode: "execute" });
  });
});

describe("REQ-CFG-1 required in production", () => {
  it("REQ-CFG-1: a complete production environment loads", () => {
    const config = loadApiConfig(productionEnv());
    expect(config.runtime.isProduction).toBe(true);
    expect(config.email.transport).toMatchObject({
      kind: "smtp",
      host: "mail.example.com",
    });
  });

  it("REQ-CFG-1: only production enforces the required variables", () => {
    expect(() => loadApiConfig({})).not.toThrow();
    expect(() => loadApiConfig({ NODE_ENV: "production" })).toThrow(
      ConfigError,
    );
    // Vercel preview and production deployments are production too.
    expect(() => loadApiConfig({ VERCEL: "1" })).toThrow(ConfigError);
    expect(() => loadApiConfig({ VERCEL_ENV: "production" })).toThrow(
      ConfigError,
    );
  });

  it("REQ-CFG-1: reports every missing variable in one aggregated error", () => {
    const error = loadFailure(() => loadApiConfig({ NODE_ENV: "production" }));

    const named = error.issues.map((issue) => issue.variable);
    for (const name of [
      "DATABASE_URL",
      "API_URL",
      "APP_URL",
      "BETTER_AUTH_SECRET",
      "PORTAL_SERVICE_USER_ID",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
      "R2_BUCKET_NAME",
      "R2_MEDIA_BUCKET_NAME",
      "SIGNING_MASTER_KEY",
      "INTEGRATIONS_MASTER_KEY",
      "PUBLIC_API_MASTER_KEY",
      "QUOTE_APPROVAL_CODE_PEPPER",
      "CRON_SECRET",
    ]) {
      expect(named).toContain(name);
      expect(error.message).toContain(name);
    }
    // Cross-variable rules are reported in the same pass.
    expect(error.message).toContain("R2_ACCOUNT_ID or R2_ENDPOINT");
    expect(error.message).toContain("SMTP_HOST or RESEND_API_KEY");
    expect(error.message).toContain("api");
  });

  it("REQ-CFG-1: a type error and a missing variable are listed together", () => {
    const error = loadFailure(() =>
      loadApiConfig(
        productionEnv({
          DATABASE_URL: undefined,
          SMTP_PORT: "many",
          PORT: "70000",
          APP_URL: "not a url",
        }),
      ),
    );

    const named = error.issues.map((issue) => issue.variable);
    expect(named).toEqual(
      expect.arrayContaining(["DATABASE_URL", "SMTP_PORT", "PORT", "APP_URL"]),
    );
    expect(error.issues.length).toBeGreaterThanOrEqual(4);
  });

  it("REQ-CFG-1: production secrets must be well formed", () => {
    const error = loadFailure(() =>
      loadApiConfig(
        productionEnv({
          BETTER_AUTH_SECRET: "too-short",
          SIGNING_MASTER_KEY: "not-a-256-bit-key",
        }),
      ),
    );
    const named = error.issues.map((issue) => issue.variable);
    expect(named).toContain("BETTER_AUTH_SECRET");
    expect(named).toContain("SIGNING_MASTER_KEY");
    // Development keeps working with short placeholder secrets.
    expect(() =>
      loadApiConfig({
        BETTER_AUTH_SECRET: "short",
        SIGNING_MASTER_KEY: "dev-key",
      }),
    ).not.toThrow();
  });

  it("REQ-CFG-1: Resend alone satisfies the e-mail requirement, and R2_ACCOUNT_ID the storage one", () => {
    expect(() =>
      loadApiConfig(
        productionEnv({
          SMTP_HOST: undefined,
          RESEND_API_KEY: "re_key",
          R2_ENDPOINT: undefined,
          R2_ACCOUNT_ID: "acct",
        }),
      ),
    ).not.toThrow();
  });

  it("REQ-CFG-1: an unknown EMAIL_TRANSPORT or a bad SMTP_PORT is an error naming the variable", () => {
    const transport = loadFailure(() =>
      loadApiConfig({ EMAIL_TRANSPORT: "smpt" }),
    );
    expect(transport.message).toContain("EMAIL_TRANSPORT");
    const incomplete = loadFailure(() =>
      loadApiConfig({ EMAIL_TRANSPORT: "smtp" }),
    );
    expect(incomplete.message).toContain("SMTP_HOST");
    const port = loadFailure(() =>
      loadApiConfig({ SMTP_HOST: "h", SMTP_PORT: "abc" }),
    );
    expect(port.message).toContain("SMTP_PORT");
  });

  it("REQ-CFG-1: SMTP and Resend transports resolve as before", () => {
    expect(
      loadApiConfig({ SMTP_HOST: "h", SMTP_SECURE: "true" }).email.transport,
    ).toEqual({
      kind: "smtp",
      host: "h",
      port: 465,
      secure: true,
      user: undefined,
      password: undefined,
    });
    expect(
      loadApiConfig({ SMTP_HOST: "h", RESEND_API_KEY: "re_x" }).email.transport
        ?.kind,
    ).toBe("smtp");
    expect(
      loadApiConfig({
        SMTP_HOST: "h",
        RESEND_API_KEY: "re_x",
        EMAIL_TRANSPORT: "Resend",
      }).email.transport,
    ).toEqual({ kind: "resend", apiKey: "re_x" });
  });
});

describe("REQ-CFG-1 secrets are never echoed", () => {
  it("REQ-CFG-1: an invalid value never appears in the error, secret or not", () => {
    const error = loadFailure(() =>
      loadApiConfig(
        productionEnv({
          BETTER_AUTH_SECRET: SECRET_SENTINEL.slice(0, 12),
          SIGNING_MASTER_KEY: SECRET_SENTINEL,
          INTEGRATIONS_MASTER_KEY: SECRET_SENTINEL,
          DATABASE_POOL_MAX: SECRET_SENTINEL,
          APP_URL: SECRET_SENTINEL,
          SMTP_PORT: SECRET_SENTINEL,
          SMTP_PASSWORD: SECRET_SENTINEL,
          EMAIL_TRANSPORT: SECRET_SENTINEL,
          NODE_ENV: "production",
        }),
      ),
    );

    expect(error.issues.length).toBeGreaterThan(0);
    const dump = `${error.message}\n${JSON.stringify(error.issues)}\n${String(error.stack)}`;
    expect(dump).not.toContain(SECRET_SENTINEL);
    expect(dump).not.toContain(SECRET_SENTINEL.slice(0, 12));
    expect(dump).not.toContain("postgres://user:pass");
  });

  it("REQ-CFG-1: the configuration is not echoed when only some other variable is wrong", () => {
    const error = loadFailure(() =>
      loadApiConfig(
        productionEnv({
          DATABASE_URL: `postgres://u:${SECRET_SENTINEL}@h/db`,
          PORT: "nope",
        }),
      ),
    );
    expect(error.message).not.toContain(SECRET_SENTINEL);
  });
});

describe("REQ-CFG-1 other runtimes", () => {
  it("REQ-CFG-1: the worker always needs its database, storage and keys", () => {
    const error = loadFailure(() => loadWorkerConfig({}));
    const named = error.issues.map((issue) => issue.variable);
    expect(named).toEqual(
      expect.arrayContaining([
        "DATABASE_URL",
        "R2_BUCKET_NAME",
        "R2_ACCESS_KEY_ID",
        "R2_SECRET_ACCESS_KEY",
        "SIGNING_MASTER_KEY",
        "INTEGRATIONS_MASTER_KEY",
      ]),
    );
    expect(error.runtime).toBe("worker");
  });

  it("REQ-CFG-1: the worker loads with the values it needs and exposes queue tunables", () => {
    const key = Buffer.alloc(32, 9).toString("base64");
    const config = loadWorkerConfig({
      DATABASE_URL: "postgres://a/b",
      R2_ENDPOINT: "http://localhost:59000",
      R2_ACCESS_KEY_ID: "id",
      R2_SECRET_ACCESS_KEY: "secret",
      R2_BUCKET_NAME: "docs",
      R2_MEDIA_BUCKET_NAME: "media",
      SIGNING_MASTER_KEY: key,
      INTEGRATIONS_MASTER_KEY: key,
      QUEUE_BATCH_SIZE: "25",
    });
    expect(config.jobs.queueBatchSize).toBe(25);
    expect(config.jobs.queuePollIntervalMs).toBe(2_000);
    expect(config.jobs.queueStaleAfterMs).toBe(600_000);
  });

  it("REQ-CFG-1: the local server keeps its development defaults and rejects a bad port", () => {
    const config = loadLocalServerConfig({});
    expect(config.localServer).toMatchObject({
      host: "127.0.0.1",
      port: 4317,
      syncEnabled: true,
      requirePartition: false,
      deviceId: "local-dev-device",
    });
    expect(
      loadLocalServerConfig({ CALIBRA_LOCAL_PORT: "5000" }).localServer.port,
    ).toBe(5000);
    expect(
      loadFailure(() => loadLocalServerConfig({ CALIBRA_LOCAL_PORT: "x" }))
        .message,
    ).toContain("CALIBRA_LOCAL_PORT");
  });

  it("REQ-CFG-1: the web and portal runtime settings are typed URLs and text", () => {
    expect(
      loadWebConfig({ VITE_API_URL: "https://api.example.com" }).web.apiUrl,
    ).toBe("https://api.example.com");
    expect(
      loadFailure(() => loadWebConfig({ VITE_API_URL: "nope" })).message,
    ).toContain("VITE_API_URL");
    expect(
      loadPortalConfig({ VITE_WEB_URL: "https://app.example.com" }).portal
        .webUrl,
    ).toBe("https://app.example.com");
  });

  it("REQ-CFG-1: a concern reader validates only its own variables", () => {
    expect(
      readDatabaseConfig({ DATABASE_URL: "postgres://a/b", APP_URL: "nope" })
        .url,
    ).toBe("postgres://a/b");
    expect(() => readDatabaseConfig({ DATABASE_POOL_MAX: "0" })).not.toThrow();
  });

  it("REQ-CFG-1: the error message names the runtime and never lists values", () => {
    const error = loadFailure(() => loadWorkerConfig({}));
    expect(error.message).toMatch(/^Invalid worker configuration/);
    expect(error.message).toContain("\n  - DATABASE_URL: ");
  });
});

describe("REQ-SP-6 SYNC_MIN_DESKTOP_VERSION", () => {
  it("REQ-SP-6: unset means no minimum", () => {
    expect(readSyncConfig({}).minDesktopVersion).toBeUndefined();
    expect(
      readSyncConfig({ SYNC_MIN_DESKTOP_VERSION: "  " }).minDesktopVersion,
    ).toBeUndefined();
    expect(loadApiConfig({}).sync.minDesktopVersion).toBeUndefined();
  });

  it("REQ-SP-6: a version is read as written", () => {
    expect(
      readSyncConfig({ SYNC_MIN_DESKTOP_VERSION: "1.4.0" }).minDesktopVersion,
    ).toBe("1.4.0");
    expect(
      loadApiConfig({ SYNC_MIN_DESKTOP_VERSION: "2.0.0-rc.1" }).sync
        .minDesktopVersion,
    ).toBe("2.0.0-rc.1");
  });

  it("REQ-SP-6: a value that is not a version stops the API at start-up, in development too", () => {
    const error = loadFailure(() =>
      loadApiConfig({ SYNC_MIN_DESKTOP_VERSION: "soon" }),
    );
    expect(error.issues.map((issue) => issue.variable)).toContain(
      "SYNC_MIN_DESKTOP_VERSION",
    );
  });
});
