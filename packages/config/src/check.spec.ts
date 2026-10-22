import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkConfig, parseEnvFile } from "./check";

vi.setConfig({ testTimeout: 60_000 });

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(packageRoot, "scripts", "check-config.ts");
const tsx = join(packageRoot, "node_modules", ".bin", "tsx");

const SENTINEL = "s3cr3t-sentinel-value-0123456789";
const KEY = Buffer.alloc(32, 4).toString("base64");

const PRODUCTION_FILE = [
  "# a production environment",
  "NODE_ENV=production",
  "DATABASE_URL=postgres://calibra:pw@db:5432/calibra",
  "API_URL=https://calibra.example.com",
  'APP_URL="https://calibra.example.com"',
  `BETTER_AUTH_SECRET=${"c".repeat(48)}`,
  "PORTAL_SERVICE_USER_ID=portal-service",
  "R2_ENDPOINT=http://s3:7070",
  "R2_ACCESS_KEY_ID=calibra",
  "R2_SECRET_ACCESS_KEY=secret",
  "R2_BUCKET_NAME=docs",
  "R2_MEDIA_BUCKET_NAME=media",
  "SMTP_HOST=mail.example.com",
  "CRON_SECRET=cron",
  `SIGNING_MASTER_KEY=${KEY}`,
  `INTEGRATIONS_MASTER_KEY=${KEY}`,
  `PUBLIC_API_MASTER_KEY=${KEY}`,
  "QUOTE_APPROVAL_CODE_PEPPER=pepper",
  "",
].join("\n");

describe("REQ-CFG-6 parseEnvFile", () => {
  it("REQ-CFG-6: reads KEY=VALUE lines, quotes, comments and export prefixes", () => {
    const { env, problems } = parseEnvFile(
      [
        "# comment",
        "",
        "A=1",
        'B="two words"',
        "C='single'",
        "export D=4",
        "E=",
        "F=a=b",
        "  G = 7  ",
      ].join("\n"),
    );
    expect(problems).toEqual([]);
    expect(env).toEqual({
      A: "1",
      B: "two words",
      C: "single",
      D: "4",
      E: "",
      F: "a=b",
      G: "7",
    });
  });

  it("REQ-CFG-6: reports malformed lines by number, never by content", () => {
    const { problems } = parseEnvFile(`GOOD=1\nthis line has ${SENTINEL}\n`);
    expect(problems).toEqual(["line 2 is not KEY=VALUE"]);
    expect(problems.join()).not.toContain(SENTINEL);
  });
});

describe("REQ-CFG-6 checkConfig", () => {
  it("REQ-CFG-6: a complete production environment passes for the api and the worker", () => {
    const { env } = parseEnvFile(PRODUCTION_FILE);

    const api = checkConfig("api", env);
    expect(api.ok).toBe(true);
    expect(api.report).toContain("api configuration is valid");
    expect(api.report).toContain("production");

    expect(checkConfig("worker", env).ok).toBe(true);
  });

  it("REQ-CFG-6: a missing variable fails with the aggregated report", () => {
    const { env } = parseEnvFile(PRODUCTION_FILE);
    delete env.CRON_SECRET;
    delete env.DATABASE_URL;

    const result = checkConfig("api", env);
    expect(result.ok).toBe(false);
    expect(result.report).toMatch(/^Invalid api configuration \(2 problems\)/);
    expect(result.report).toContain("CRON_SECRET");
    expect(result.report).toContain("DATABASE_URL");
  });

  it("REQ-CFG-6: never echoes a value, secret or not", () => {
    const { env } = parseEnvFile(PRODUCTION_FILE);
    env.SIGNING_MASTER_KEY = SENTINEL;
    env.BETTER_AUTH_SECRET = SENTINEL.slice(0, 10);
    env.APP_URL = SENTINEL;
    env.SMTP_PORT = SENTINEL;

    const result = checkConfig("api", env);
    expect(result.ok).toBe(false);
    for (const variable of [
      "SIGNING_MASTER_KEY",
      "BETTER_AUTH_SECRET",
      "APP_URL",
      "SMTP_PORT",
    ]) {
      expect(result.report).toContain(variable);
    }
    expect(result.report).not.toContain(SENTINEL);
    expect(result.report).not.toContain(SENTINEL.slice(0, 10));
  });

  it("REQ-CFG-6: --production applies the production requirements to a file that does not say so", () => {
    const { env } = parseEnvFile("DATABASE_URL=postgres://a/b\n");

    const development = checkConfig("api", env);
    expect(development.ok).toBe(true);
    expect(development.report).toMatch(/only types were checked/i);
    expect(development.report).toContain("--production");

    const production = checkConfig("api", env, { production: true });
    expect(production.ok).toBe(false);
    expect(production.report).toContain("BETTER_AUTH_SECRET");
  });

  it("REQ-CFG-6: checks the worker's own requirements, and the local server's", () => {
    const worker = checkConfig("worker", {});
    expect(worker.ok).toBe(false);
    expect(worker.report).toMatch(/^Invalid worker configuration/);
    expect(worker.report).toContain("DATABASE_URL");

    expect(checkConfig("local-server", {}).ok).toBe(true);
    const bad = checkConfig("local-server", { CALIBRA_LOCAL_PORT: "x" });
    expect(bad.ok).toBe(false);
    expect(bad.report).toContain("CALIBRA_LOCAL_PORT");
  });
});

describe("REQ-CFG-6 the check-config script", () => {
  const scratch: string[] = [];

  afterEach(() => {
    for (const directory of scratch.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function envFile(contents: string): string {
    const directory = mkdtempSync(join(tmpdir(), "calibra-check-"));
    scratch.push(directory);
    const file = join(directory, "prod.env");
    writeFileSync(file, contents);
    return file;
  }

  function run(args: string[], env: Record<string, string> = {}, cwd?: string) {
    return spawnSync(tsx, [script, ...args], {
      encoding: "utf8",
      cwd,
      // Only PATH: the check must not see this process's own environment.
      env: { PATH: process.env.PATH ?? "", ...env },
    });
  }

  it("REQ-CFG-6: exits 0 for a valid env file", () => {
    const result = run([
      "--runtime",
      "api",
      "--env-file",
      envFile(PRODUCTION_FILE),
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("api configuration is valid");
  });

  it("REQ-CFG-6: exits 1 and prints the aggregated report for an invalid env file, without echoing values", () => {
    const file = envFile(
      `${PRODUCTION_FILE}\nSMTP_PORT=${SENTINEL}\nSIGNING_MASTER_KEY=${SENTINEL}\n`,
    );
    const result = run(["--runtime", "api", "--env-file", file]);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Invalid api configuration/);
    expect(result.stderr).toContain("SMTP_PORT");
    expect(result.stderr).toContain("SIGNING_MASTER_KEY");
    expect(`${result.stdout}${result.stderr}`).not.toContain(SENTINEL);
  });

  it("REQ-CFG-6: reads the process environment when no file is given", () => {
    const result = run(["--runtime", "worker"], { NODE_ENV: "production" });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Invalid worker configuration/);

    const local = run(["--runtime", "local-server"], {
      CALIBRA_LOCAL_PORT: "5000",
    });
    expect(local.status).toBe(0);
  });

  it("REQ-CFG-6: an env file replaces the process environment instead of merging with it", () => {
    const result = run(
      ["--runtime", "api", "--env-file", envFile("NODE_ENV=production\n")],
      { DATABASE_URL: "postgres://from-process/db" },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("DATABASE_URL");
  });

  it("REQ-CFG-6: --production applies the production rules to a development file", () => {
    const file = envFile("DATABASE_URL=postgres://a/b\n");
    expect(run(["--runtime", "api", "--env-file", file]).status).toBe(0);
    expect(
      run(["--runtime", "api", "--env-file", file, "--production"]).status,
    ).toBe(1);
  });

  it("REQ-CFG-6: a relative --env-file is resolved from the current directory", () => {
    const file = envFile(PRODUCTION_FILE);
    const result = run(
      ["--runtime", "api", "--env-file", "prod.env"],
      {},
      dirname(file),
    );
    expect(result.status).toBe(0);
  });

  it("REQ-CFG-6: usage errors exit 2 with a hint", () => {
    const missing = run([]);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain("--runtime");

    const unknown = run(["--runtime", "toaster"]);
    expect(unknown.status).toBe(2);
    expect(unknown.stderr).toMatch(/api\|worker\|local-server/);

    // Node itself also reads `--env-file`, so a missing file is reported by the
    // runtime (non-zero, "not found") before the script runs.
    const nofile = run([
      "--runtime",
      "api",
      "--env-file",
      "/nonexistent/prod.env",
    ]);
    expect(nofile.status).not.toBe(0);
    expect(nofile.stderr).toMatch(/not found|cannot read/);
  });
});
