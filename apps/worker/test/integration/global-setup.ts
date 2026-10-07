import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import type { GlobalSetupContext } from "vitest/node";
import { assertEphemeralTestDb } from "./guard";

// Vitest globalSetup for the worker real-DB integration tier. Cloned from
// apps/api/test/integration/global-setup.ts — the Docker boot + `drizzle-kit
// push` + schema build are data-layer agnostic. Boots ONE ephemeral Postgres
// via raw `docker run` (the repo's pnpm build-script allowlist rejects
// testcontainers' native deps, so we avoid the dependency), builds the schema
// once via `drizzle-kit push` (the corrected schema cold-builds — see migration
// 0060), and hands the connection URL to workers via `provide`. The per-worker
// `setup.ts` sets process.env.DATABASE_URL before any db access; the worker
// handlers connect via a raw `pg.Client` keyed on that same DATABASE_URL, so
// they hit the same physical Postgres the drizzle seed writes to.
//
// CI can skip Docker by setting TEST_DATABASE_URL to a service-container Postgres.

// Unique per run so parallel worktrees (Phase 2 makers, CI matrix) don't collide.
const CONTAINER = `cf-worker-int-pg-${process.pid}`;
const dbDir = fileURLToPath(
  new URL("../../../../packages/db", import.meta.url),
);

let startedContainer: string | null = null;

// The Postgres image this tier runs is the one docker-compose.yml pins for
// development, so an update to it (Dependabot bumps it there) is exercised here
// before it merges. TEST_POSTGRES_IMAGE overrides it.
function postgresImage(): string {
  const override = process.env.TEST_POSTGRES_IMAGE;
  if (override) return override;
  const compose = readFileSync(
    new URL("../../../../docker-compose.yml", import.meta.url),
    "utf8",
  );
  const pinned = compose.match(/^\s*image:\s*(postgres:\S+)/m)?.[1];
  if (!pinned) throw new Error("docker-compose.yml pins no postgres image");
  return pinned;
}

function tryExec(cmd: string) {
  try {
    execSync(cmd, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export async function setup({ provide }: GlobalSetupContext) {
  let url = process.env.TEST_DATABASE_URL;

  if (!url) {
    // Let Docker assign a free host port (-p 0:5432) so concurrent runs don't clash.
    execSync(
      `docker run -d --name ${CONTAINER} -e POSTGRES_PASSWORD=test -e POSTGRES_DB=calibra -p 0:5432 ${postgresImage()}`,
      { stdio: "ignore" },
    );
    startedContainer = CONTAINER;

    const mapped = execSync(`docker port ${CONTAINER} 5432`).toString().trim();
    const port = mapped.split(":").pop();
    if (!port)
      throw new Error(`could not resolve mapped port from "${mapped}"`);

    // Wait for pg_isready to first succeed (initdb phase).
    let ready = false;
    for (let i = 0; i < 60; i += 1) {
      if (tryExec(`docker exec ${CONTAINER} pg_isready -U postgres`)) {
        ready = true;
        break;
      }
      await sleep(1000);
    }
    if (!ready) throw new Error("integration Postgres did not become ready");

    // The official postgres image does a fast-shutdown + restart after initdb: pg_isready
    // passes during the init phase, the server bounces, then comes up in main mode.
    // Without waiting out that cycle, the first real query hits ECONNREFUSED. Wait
    // for the restart, then re-verify.
    await sleep(3000);
    ready = false;
    for (let i = 0; i < 30; i += 1) {
      if (tryExec(`docker exec ${CONTAINER} pg_isready -U postgres`)) {
        ready = true;
        break;
      }
      await sleep(1000);
    }
    if (!ready)
      throw new Error("integration Postgres restart did not complete");

    // 127.0.0.1 (not localhost) so postgres-js doesn't try the IPv6 ::1 route first
    // when Docker only maps IPv4.
    url = `postgres://postgres:test@127.0.0.1:${port}/calibra`;
  }

  // Refuse to push the schema at (and later TRUNCATE) anything but a local/
  // ephemeral DB — a remote/Neon TEST_DATABASE_URL aborts here, before any DDL.
  assertEphemeralTestDb(url);

  execSync("pnpm exec drizzle-kit push --force", {
    cwd: dbDir,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
  });

  provide("testDatabaseUrl", url);
}

export async function teardown() {
  if (startedContainer) tryExec(`docker rm -f ${startedContainer}`);
}

declare module "vitest" {
  interface ProvidedContext {
    testDatabaseUrl: string;
  }
}
