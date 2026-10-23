import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import type { GlobalSetupContext } from "vitest/node";
import { assertEphemeralTestDb } from "./guard";

// Vitest globalSetup for the real-DB integration tier. Boots ONE ephemeral
// Postgres via raw `docker run`, builds the schema once via `drizzle-kit push`
// into a TEMPLATE database, then hands base connection params + template name to
// workers via `provide`. Each per-worker `setup.ts` creates its OWN database
// (calibra_w<VITEST_POOL_ID>) via `CREATE DATABASE … TEMPLATE calibra_tmpl` so
// files run in PARALLEL without sharing data.
//
// CI can skip Docker by setting TEST_DATABASE_URL to a service-container Postgres;
// in that case we strip the db name and build the same template/per-worker pattern.

// Unique per run so parallel worktrees (Phase 2 makers, CI matrix) don't collide.
const CONTAINER = `cf-api-int-pg-${process.pid}`;
const dbDir = fileURLToPath(
  new URL("../../../../packages/db", import.meta.url),
);

const TEMPLATE_DB = "calibra_tmpl";

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

/**
 * The whole sql/schema-extras.sql: the objects drizzle-kit push cannot create from
 * schema.ts (extensions + immutable_unaccent, partial/NULLS NOT DISTINCT unique
 * indexes, CHECK constraints, the regulated-invariant triggers). Production gets
 * the same file from `db:bootstrap`, so the test template carries every constraint
 * production enforces, not a subset.
 */
function schemaExtrasSql(): string {
  return readFileSync(
    new URL("../../../../packages/db/sql/schema-extras.sql", import.meta.url),
    "utf8",
  );
}

let startedContainer: string | null = null;

function tryExec(cmd: string) {
  try {
    execSync(cmd, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Build PG env vars for psql/createdb from a postgres:// URL. */
function pgEnvFromUrl(rawUrl: string): Record<string, string> {
  const u = new URL(rawUrl);
  return {
    PGHOST: u.hostname,
    PGPORT: u.port || "5432",
    PGUSER: decodeURIComponent(u.username || "postgres"),
    PGPASSWORD: decodeURIComponent(u.password || ""),
  };
}

export async function setup({ provide }: GlobalSetupContext) {
  let baseUrl: string; // postgres://user:pass@host:port  (NO db name)

  const externalUrl = process.env.TEST_DATABASE_URL;

  if (!externalUrl) {
    // Let Docker assign a free host port (-p 0:5432) so concurrent runs don't clash.
    // max_locks_per_transaction is raised from the default 64 to 256: with 6 parallel
    // workers each TRUNCATEing tables that CASCADE into many FK-related tables, the
    // default lock table fills up and causes "out of shared memory" errors.
    execSync(
      `docker run -d --name ${CONTAINER} -e POSTGRES_PASSWORD=test -e POSTGRES_DB=postgres -p 0:5432 ${postgresImage()} -c max_locks_per_transaction=256`,
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
    baseUrl = `postgres://postgres:test@127.0.0.1:${port}`;
  } else {
    // CI service-container path: strip the db name from the provided URL so we
    // always build and connect via the template pattern.
    const parsed = new URL(externalUrl);
    parsed.pathname = "";
    baseUrl = parsed.toString().replace(/\/$/, "");
  }

  const templateUrl = `${baseUrl}/${TEMPLATE_DB}`;

  // Refuse to push the schema at (and later TRUNCATE) anything but a local/
  // ephemeral DB — a remote/Neon TEST_DATABASE_URL aborts here, before any DDL.
  assertEphemeralTestDb(templateUrl);

  // Create the template database via psql env vars (avoids shell-quoting issues
  // with special characters in passwords).
  const pgEnv = { ...process.env, ...pgEnvFromUrl(baseUrl) };
  execSync(`psql -d postgres -c "CREATE DATABASE ${TEMPLATE_DB}"`, {
    env: pgEnv,
    stdio: "ignore",
  });

  // Push the schema (all ~131 tables) into the template database exactly once.
  // Every per-worker DB will be cloned from this template, so schema setup cost
  // is paid once regardless of how many workers are running.
  execSync("pnpm exec drizzle-kit push --force", {
    cwd: dbDir,
    env: { ...process.env, DATABASE_URL: templateUrl },
    stdio: "inherit",
  });

  // Apply the migration-only DB objects that `drizzle-kit push` can't create from
  // the schema, from the same sql/schema-extras.sql `db:bootstrap` applies in
  // production. The template therefore enforces what production enforces: the
  // one-default-per-organization partial unique indexes (migrations 0029/0031)
  // included. Tests that assume those constraints are absent are bugs to fix.
  execSync(`psql -v ON_ERROR_STOP=1 -d ${TEMPLATE_DB}`, {
    // client_min_messages: the RLS block's DROP POLICY IF EXISTS prints one
    // NOTICE per tenant table on a fresh template; keep real warnings only.
    env: {
      ...pgEnv,
      PGDATABASE: TEMPLATE_DB,
      PGOPTIONS: "-c client_min_messages=warning",
    },
    input: schemaExtrasSql(),
    stdio: ["pipe", "ignore", "inherit"],
  });

  // Provide base connection URL (no db name) and template name so per-worker
  // setup can create calibra_w<id> = CREATE DATABASE … TEMPLATE calibra_tmpl.
  provide("testDbBaseUrl", baseUrl);
  provide("testDbTemplate", TEMPLATE_DB);
}

export async function teardown() {
  if (startedContainer) tryExec(`docker rm -f ${startedContainer}`);
}

declare module "vitest" {
  interface ProvidedContext {
    testDbBaseUrl: string;
    testDbTemplate: string;
  }
}
