import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigError } from "@calibra-facil/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkerEnv } from "./queue-runtime.js";

// Some cases start a real process (bun/tsx); under a parallel `turbo test` the
// default 5s is not enough.
vi.setConfig({ testTimeout: 60_000 });

const workerRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const REQUIRED = [
  "DATABASE_URL",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "SIGNING_MASTER_KEY",
  "INTEGRATIONS_MASTER_KEY",
];

describe("worker start-up configuration (REQ-CFG-2)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("REQ-CFG-2: building the worker environment without the required variables fails with one aggregated error", () => {
    for (const name of REQUIRED) vi.stubEnv(name, "");

    let error: unknown;
    try {
      createWorkerEnv();
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ConfigError);
    const message = error instanceof Error ? error.message : "";
    expect(message).toMatch(/^Invalid worker configuration/);
    for (const name of REQUIRED) expect(message).toContain(name);
  });

  it("REQ-CFG-2: a complete environment builds the worker environment", () => {
    const key = Buffer.alloc(32, 3).toString("base64");
    vi.stubEnv("DATABASE_URL", "postgres://calibra:pw@db:5432/calibra");
    vi.stubEnv("R2_ENDPOINT", "http://s3:7070");
    vi.stubEnv("R2_ACCESS_KEY_ID", "calibra");
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "secret");
    vi.stubEnv("R2_BUCKET_NAME", "docs");
    vi.stubEnv("R2_MEDIA_BUCKET_NAME", "media");
    vi.stubEnv("SIGNING_MASTER_KEY", key);
    vi.stubEnv("INTEGRATIONS_MASTER_KEY", key);

    const env = createWorkerEnv();
    expect(env.DATABASE_URL).toBe("postgres://calibra:pw@db:5432/calibra");
    expect(env.SIGNING_MASTER_KEY).toBe(key);
  });
});

const bun = spawnSync("bun", ["--version"], { encoding: "utf8" });

describe.skipIf(bun.status !== 0)("the worker entries", () => {
  for (const entry of ["src/bun.ts", "src/serve.ts"]) {
    it(`REQ-CFG-2: ${entry} exits non-zero with the aggregated message when required variables are missing`, () => {
      const run = spawnSync("bun", [entry], {
        cwd: workerRoot,
        encoding: "utf8",
        timeout: 60_000,
        // Nothing but PATH: no inherited secrets, no .env (production skips it).
        env: { PATH: process.env.PATH ?? "", NODE_ENV: "production" },
      });

      expect(run.status).toBe(1);
      expect(run.stderr).toMatch(/Invalid worker configuration/);
      expect(run.stderr).toContain("DATABASE_URL");
      expect(run.stdout).not.toContain("Starting");
      expect(run.stdout).not.toContain("Listening");
    });
  }
});
