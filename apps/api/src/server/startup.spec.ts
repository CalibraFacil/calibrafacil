import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigError } from "@calibra-facil/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApiBootEnv } from "./startup";

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const KEY = Buffer.alloc(32, 5).toString("base64");

function productionEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    NODE_ENV: "production",
    DATABASE_URL: "postgres://calibra:pw@db:5432/calibra",
    API_URL: "https://calibra.example.com",
    APP_URL: "https://calibra.example.com",
    BETTER_AUTH_SECRET: "b".repeat(48),
    PORTAL_SERVICE_USER_ID: "portal-service",
    R2_ENDPOINT: "http://s3:7070",
    R2_ACCESS_KEY_ID: "calibra",
    R2_SECRET_ACCESS_KEY: "secret",
    R2_BUCKET_NAME: "docs",
    R2_MEDIA_BUCKET_NAME: "media",
    SMTP_HOST: "mail.example.com",
    CRON_SECRET: "cron",
    SIGNING_MASTER_KEY: KEY,
    INTEGRATIONS_MASTER_KEY: KEY,
    PUBLIC_API_MASTER_KEY: KEY,
    QUOTE_APPROVAL_CODE_PEPPER: "pepper",
    ...overrides,
  };
}

function failure(start: () => unknown): ConfigError {
  try {
    start();
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error("expected a ConfigError");
}

describe("API start-up configuration (REQ-CFG-2)", () => {
  it("REQ-CFG-2: a production boot without its required variables fails with one aggregated error", () => {
    const error = failure(() => buildApiBootEnv({ NODE_ENV: "production" }));

    expect(error.message).toMatch(/^Invalid api configuration/);
    for (const name of [
      "DATABASE_URL",
      "BETTER_AUTH_SECRET",
      "R2_BUCKET_NAME",
      "SIGNING_MASTER_KEY",
      "CRON_SECRET",
    ]) {
      expect(error.message).toContain(name);
    }
  });

  it("REQ-CFG-2: a malformed value stops the boot without echoing it", () => {
    const sentinel = "do-not-print-this-value";
    const error = failure(() =>
      buildApiBootEnv(
        productionEnv({ SIGNING_MASTER_KEY: sentinel, APP_URL: sentinel }),
      ),
    );

    expect(error.message).toContain("SIGNING_MASTER_KEY");
    expect(error.message).toContain("APP_URL");
    expect(error.message).not.toContain(sentinel);
  });

  it("REQ-CFG-2: a complete production environment boots", () => {
    const { bindings, config } = buildApiBootEnv(productionEnv());

    expect(config.runtime.isProduction).toBe(true);
    expect(bindings.DATABASE_URL).toBe("postgres://calibra:pw@db:5432/calibra");
  });

  it("REQ-CFG-2: development keeps working with the local defaults and an empty environment", () => {
    const { bindings, config } = buildApiBootEnv({});

    expect(config.runtime.isProduction).toBe(false);
    expect(bindings.API_URL).toBe("http://localhost:3000");
    expect(bindings.APP_URL).toBe("http://localhost:5173");
    expect(bindings.PORTAL_APP_URL).toBe("http://localhost:5174");
    expect(bindings.R2_BUCKET_NAME).toBe("calibrafacil-documents-dev");
  });

  it("REQ-CFG-2: the local .env files sit between the defaults and the real environment", () => {
    const { bindings } = buildApiBootEnv(
      { APP_URL: "http://localhost:9000" },
      {
        APP_URL: "http://localhost:1",
        HYPERDRIVE_LOCAL_CONNECTION_STRING: "postgres://local/db",
      },
    );

    expect(bindings.APP_URL).toBe("http://localhost:9000");
    expect(bindings.DATABASE_URL).toBe("postgres://local/db");
  });
});

describe("Vercel function entries validate at cold start (REQ-CFG-2)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  for (const entry of [
    "../../vercel-src/index",
    "../../vercel-src/queues/background",
    "../../vercel-src/cron/main",
  ]) {
    it(`REQ-CFG-2: ${entry.replace("../../vercel-src/", "")} refuses to load a production environment that misses required variables`, async () => {
      vi.stubEnv("VERCEL", "1");
      vi.stubEnv("NODE_ENV", "production");
      for (const name of [
        "DATABASE_URL",
        "BETTER_AUTH_SECRET",
        "R2_BUCKET_NAME",
        "SIGNING_MASTER_KEY",
      ]) {
        vi.stubEnv(name, "");
      }
      vi.resetModules();

      await expect(import(/* @vite-ignore */ entry)).rejects.toThrow(
        /Invalid api configuration[\s\S]*DATABASE_URL/,
      );
    });
  }
});

const bun = spawnSync("bun", ["--version"], { encoding: "utf8" });

describe.skipIf(bun.status !== 0)("the Bun entry (src/bun.ts)", () => {
  it("REQ-CFG-2: exits non-zero with the aggregated message when production variables are missing", () => {
    const run = spawnSync("bun", ["src/bun.ts"], {
      cwd: apiRoot,
      encoding: "utf8",
      timeout: 60_000,
      // Nothing but PATH: no inherited secrets, no .env (production skips it).
      env: { PATH: process.env.PATH ?? "", NODE_ENV: "production" },
    });

    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/Invalid api configuration/);
    expect(run.stderr).toContain("DATABASE_URL");
    expect(run.stdout).not.toContain("listening");
  });
});
