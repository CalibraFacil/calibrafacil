import { AsyncLocalStorage } from "node:async_hooks";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import {
  createRoleDatabase,
  type RoleDatabase,
} from "@calibra-facil/db/role-connection";
import { POLICY_NAME, rlsTables } from "@calibra-facil/db/rls-sql";
import {
  createTransactionScopeRunner,
  currentTransactionScope,
} from "@calibra-facil/db/testing";
import { assertHarnessWorkerDb } from "./guard";
import {
  normalizeStatement,
  requestPathOf,
  sourceModuleFromStack,
} from "./rls-shadow-report-lib";

// RLS "violation report" mode of the integration tier (roadmap P2-3), switched on
// by CALIBRA_RLS_SHADOW=1 (see apps/api/scripts/rls-shadow-report.mjs). It never
// runs in the normal suites: with the variable unset `shadowDatabase` returns the
// real `@calibra-facil/db` module untouched.
//
// What it does: every HTTP request a spec sends (`app.request(...)`) is handled
// with its database access on a pool whose sessions run as `calibra_app`, so the
// `tenant_isolation` policies bind the application code; the specs' own seeding
// and assertions keep the owner connection (they are the harness, not the app).
// A statement that reaches a tenant table without `calibra.organization_id` set
// in its transaction matches no row under calibra_app; in this mode the worker
// database's policies call `calibra_rls_probe_org()` instead of reading the
// setting directly (same result, fail closed) and the function raises a WARNING
// carrying `current_query()`, which this module records per spec and test. A write
// refused by WITH CHECK is an error and shows as a failing test.
//
// Attribution: each request carries its path, and the application module that
// obtained the database handle (innermost stack frame outside drizzle, packages/db,
// lib/org-db.ts and the harness) is captured when the handle is accessed; the
// statement text the pool logs is joined to the server's warning, so every
// unscoped statement is reported with the module and request path that issued it.
// Concurrent statements of one text in one process (a Promise.all race) may be
// attributed to the latest issuer.
//
// Limits: a statement on an EMPTY table does not evaluate the policy, so it is not
// reported; work started outside `request()` (a spec calling a lib function
// directly, a cron/queue handler) stays on the owner connection.

const MARKER = "calibra-rls: no organization set | ";

type Store = {
  readonly app: true;
  /** Pathname of the HTTP request being handled. */
  readonly path: string;
  /** Application module that obtained the handle, once known. */
  readonly source: string | null;
};
const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/** Latest issuer of each statement text, to attribute the server's warning. */
const origins = new Map<string, Store>();

function tagAccess(): void {
  const store = context.getStore();
  if (!store) return;
  const holder: { stack?: string } = {};
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 14;
  Error.captureStackTrace(holder);
  Error.stackTraceLimit = limit;
  const source = sourceModuleFromStack(holder.stack ?? "", REPO_ROOT);
  // drizzle re-enters the proxy from microtasks with no application frame: keep
  // the tag the original call site set.
  if (source) context.enterWith({ ...store, source });
}
const context = new AsyncLocalStorage<Store>();

export function shadowModeEnabled(): boolean {
  return process.env.CALIBRA_RLS_SHADOW === "1";
}

function record(entry: Record<string, unknown>): void {
  const file = process.env.CALIBRA_RLS_SHADOW_REPORT;
  if (file) appendFileSync(file, `${JSON.stringify(entry)}\n`);
}

const PROBE_FUNCTION = `CREATE OR REPLACE FUNCTION calibra_rls_probe_org() RETURNS text
LANGUAGE plpgsql STABLE AS $$
DECLARE v text := nullif(current_setting('calibra.organization_id', true), '');
BEGIN
  IF v IS NULL THEN
    RAISE WARNING '${MARKER}%', current_query();
  END IF;
  RETURN v;
END
$$`;

/**
 * `strict` (default): what ships, fail closed, plus the warning. `audit`
 * (CALIBRA_RLS_SHADOW_MODE=audit): a statement with no organization set is ALLOWED
 * (and warned about), so one run walks past the first such statement of every
 * request and inventories all of them; a statement with an organization set is
 * still enforced.
 */
function auditMode(): boolean {
  return process.env.CALIBRA_RLS_SHADOW_MODE === "audit";
}

/** The worker database's policies, with the probe in place of the bare setting. */
function probePolicies(): string[] {
  const statements = [PROBE_FUNCTION];
  for (const entry of rlsTables()) {
    const table = `public."${entry.table}"`;
    const enforced = `"${entry.column}" = (select calibra_rls_probe_org())::${entry.sqlType}`;
    const predicate = auditMode()
      ? `(select calibra_rls_probe_org()) IS NULL OR ${enforced}`
      : enforced;
    statements.push(
      `DROP POLICY IF EXISTS ${POLICY_NAME} ON ${table}`,
      `CREATE POLICY ${POLICY_NAME} ON ${table} AS PERMISSIVE FOR ALL TO calibra_app USING (${predicate}) WITH CHECK (${predicate})`,
    );
  }
  return statements;
}

/**
 * The `hono` module as the app sees it. Normally the real one; in shadow mode
 * `new Hono()` returns an app whose `request()` runs the whole request inside the
 * "application" async context (`request` is an instance field of Hono, so it
 * cannot be patched on the prototype).
 */
export function shadowHono<
  M extends { Hono: new (...args: never[]) => object },
>(actual: M): M {
  if (!shadowModeEnabled()) return actual;
  const Base = actual.Hono;
  class ShadowHono extends Base {
    constructor(...args: never[]) {
      super(...args);
      const original: unknown = Reflect.get(this, "request");
      if (typeof original !== "function") return;
      Reflect.set(this, "request", (...request: unknown[]) =>
        context.run(
          { app: true, path: requestPathOf(request[0]), source: null },
          () => Reflect.apply(original, this, request),
        ),
      );
    }
  }
  return { ...actual, Hono: ShadowHono };
}

let appDatabase: RoleDatabase | null = null;

/** The calibra_app pool the requests of a spec run on (created on first use). */
function applicationPool(): RoleDatabase {
  if (appDatabase) return appDatabase;
  const url = process.env.DATABASE_URL;
  assertHarnessWorkerDb(url);
  if (!url) throw new Error("rls-shadow: DATABASE_URL is not set");
  appDatabase = createRoleDatabase(url, {
    role: "calibra_app",
    max: 10,
    onNotice: (message) => {
      if (!message.startsWith(MARKER)) return;
      const state = expect.getState();
      const statement = message.slice(MARKER.length);
      const origin = origins.get(normalizeStatement(statement));
      record({
        type: "no-organization",
        file: state.testPath ?? "(unknown)",
        test: state.currentTestName ?? "(outside a test)",
        statement,
        path: origin?.path,
        source: origin?.source ?? undefined,
      });
    },
    onQuery: (query) => {
      const store = context.getStore();
      if (store) origins.set(normalizeStatement(query), store);
    },
  });
  return appDatabase;
}

/**
 * The database instance requests run on in shadow mode (the calibra_app pool),
 * or null when the harness is off. For the harness that forces an interleaving
 * inside a request's transaction (job-cas.ts): it must spy on the instance the
 * request actually uses.
 */
export function shadowApplicationDatabase(): RoleDatabase["db"] | null {
  return shadowModeEnabled() ? applicationPool().db : null;
}

/**
 * Runs `work` outside the "application" context: its database access is the
 * owner's, like the spec's own seeding. For the other actor of an interleaving
 * (it is not the application under test and must not be bound by the policies).
 */
export function outsideApplication<T>(work: () => T): T {
  return context.exit(work);
}

/**
 * The `@calibra-facil/db` module as the specs see it. Normally the real one; in
 * shadow mode `db` / `getDb()` resolve to the calibra_app pool inside a request.
 */
export function shadowDatabase<
  M extends {
    db: object;
    getDb: () => { transaction: (callback: never) => unknown };
    runInTransactionScope: unknown;
  },
>(actual: M): M {
  if (!shadowModeEnabled()) return actual;

  const appPool = applicationPool;

  const db = new Proxy(actual.db, {
    get(_, property) {
      tagAccess();
      // Inside a transaction scope `db` IS the scope's transaction (the real
      // proxy resolves it); outside one a request's statements take the
      // calibra_app pool.
      const target =
        context.getStore() && !currentTransactionScope()
          ? appPool().db
          : actual.db;
      return Reflect.get(target, property);
    },
  });
  // A request's transaction scope (the desktop sync event) opens on the
  // calibra_app pool too, not on the owner connection the real module would use.
  const runInTransactionScope = createTransactionScopeRunner((callback) =>
    (context.getStore() ? appPool().db : actual.getDb()).transaction(callback),
  );
  return {
    ...actual,
    db,
    runInTransactionScope,
    getDb: () => {
      tagAccess();
      return context.getStore() ? appPool().db : actual.getDb();
    },
  };
}

/**
 * Per worker database (call after DATABASE_URL points at it): swap the policies
 * for the probing variant and route requests through the calibra_app pool.
 */
export async function installRlsShadowMode(): Promise<void> {
  if (!shadowModeEnabled()) return;
  const url = process.env.DATABASE_URL;
  assertHarnessWorkerDb(url);
  if (!url) throw new Error("rls-shadow: DATABASE_URL is not set");
  const owner = createRoleDatabase(url, { role: null, max: 1 });
  try {
    for (const statement of probePolicies()) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- DDL, one at a time.
      await owner.db.$client.unsafe(statement);
    }
  } finally {
    await owner.close();
  }
}
