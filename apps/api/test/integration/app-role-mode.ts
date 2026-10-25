import { AsyncLocalStorage } from "node:async_hooks";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import type { QueryObserver } from "@calibra-facil/db";
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

// The application role of the integration tier (roadmap P2-3, P2-18k).
//
// Every HTTP request a spec sends (`app.request(...)`) is handled with its
// database access on a pool whose sessions run as `calibra_app`, so the
// `tenant_isolation` policies of migration 0123 bind the application code exactly
// as they do in production (DATABASE_RLS_MODE=enforced); the specs' own seeding
// and assertions keep the owner connection (they are the harness, not the
// application), and so does `systemDb` (the owner path, like DATABASE_OWNER_URL).
// A statement that reaches a tenant table without `calibra.organization_id` set
// in its transaction matches no row as calibra_app and a write for another
// organization is refused by WITH CHECK: the test that issued it fails.
//
// Debugging: CALIBRA_API_DB_ROLE=owner runs the requests on the owner connection
// like before the cutover (fast, no policy), to tell an RLS refusal from a bug.
//
// Report mode (CALIBRA_RLS_REPORT=1, apps/api/scripts/rls-shadow-report.mjs): the
// worker database's policies call `calibra_rls_probe_org()` instead of reading the
// setting directly (same result, fail closed) and the function raises a WARNING
// carrying `current_query()`, which this module records per spec and test, so one
// run lists every statement that reached a tenant table with no organization set
// (CALIBRA_RLS_REPORT_MODE=audit lets such a statement through, to walk past the
// first of each request). Attribution: each request carries its path, and the
// application module that obtained the database handle (innermost stack frame
// outside drizzle, packages/db, lib/org-db.ts and the harness) is captured when
// the handle is accessed; the statement text the pool logs is joined to the
// server's warning. Concurrent statements of one text in one process (a
// Promise.all race) may be attributed to the latest issuer.
//
// The tenant SQL guard (tenant-sql-guard.ts) keeps watching the requests: the pool
// forwards each statement and each handle access to its observer.
//
// Limits: a statement on an EMPTY table does not evaluate the policy; work started
// outside `request()` (a spec calling a lib function directly, a cron/queue
// handler) stays on the owner connection.

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

/**
 * The statement observer the tenant SQL guard installed (through the
 * `setQueryObserver` of the module the specs see, wrapped below): the calibra_app
 * pool is a second drizzle instance, so its statements and handle accesses are
 * forwarded to it by hand.
 */
let observer: QueryObserver | null = null;

/** Report mode: attribute the statements that follow to the module that asked for the handle. */
function tagAccess(): void {
  if (!reportEnabled()) return;
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

/** Requests run as calibra_app unless CALIBRA_API_DB_ROLE=owner (debugging). */
export function appRoleEnabled(): boolean {
  return process.env.CALIBRA_API_DB_ROLE !== "owner";
}

/** The shadow report's probing policies and attribution (CALIBRA_RLS_REPORT=1). */
function reportEnabled(): boolean {
  return process.env.CALIBRA_RLS_REPORT === "1";
}

function record(entry: Record<string, unknown>): void {
  const file = process.env.CALIBRA_RLS_REPORT_FILE;
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
 * (CALIBRA_RLS_REPORT_MODE=audit): a statement with no organization set is ALLOWED
 * (and warned about), so one run walks past the first such statement of every
 * request and inventories all of them; a statement with an organization set is
 * still enforced.
 */
function auditMode(): boolean {
  return process.env.CALIBRA_RLS_REPORT_MODE === "audit";
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
 * The `hono` module as the app sees it. `new Hono()` returns an app whose
 * `request()` runs the whole request inside the "application" async context
 * (`request` is an instance field of Hono, so it cannot be patched on the
 * prototype). The real module, untouched, when CALIBRA_API_DB_ROLE=owner.
 */
export function appRoleHono<
  M extends { Hono: new (...args: never[]) => object },
>(actual: M): M {
  if (!appRoleEnabled()) return actual;
  const Base = actual.Hono;
  class AppRoleHono extends Base {
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
  return { ...actual, Hono: AppRoleHono };
}

let appDatabase: RoleDatabase | null = null;

/** The calibra_app pool the requests of a spec run on (created on first use). */
function applicationPool(): RoleDatabase {
  if (appDatabase) return appDatabase;
  const url = process.env.DATABASE_URL;
  assertHarnessWorkerDb(url);
  if (!url) throw new Error("app-role: DATABASE_URL is not set");
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
    onQuery: (query, params) => {
      observer?.onQuery(query, params);
      if (!reportEnabled()) return;
      const store = context.getStore();
      if (store) origins.set(normalizeStatement(query), store);
    },
  });
  return appDatabase;
}

/**
 * The database instance requests run on (the calibra_app pool), or null when
 * the requests run as the owner (CALIBRA_API_DB_ROLE=owner). For the harness that forces an interleaving
 * inside a request's transaction (job-cas.ts): it must spy on the instance the
 * request actually uses.
 */
export function appRoleDatabaseInstance(): RoleDatabase["db"] | null {
  return appRoleEnabled() ? applicationPool().db : null;
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
 * The `@calibra-facil/db` module as the specs see it: `db` / `getDb()` resolve to
 * the calibra_app pool inside a request (the real module, untouched, when
 * CALIBRA_API_DB_ROLE=owner). `systemDb` stays the owner's.
 */
export function appRoleDatabase<
  M extends {
    db: object;
    setQueryObserver: (observer: QueryObserver | null) => void;
    getDb: () => { transaction: (callback: never) => unknown };
    runInTransactionScope: unknown;
  },
>(actual: M): M {
  if (!appRoleEnabled()) return actual;

  const appPool = applicationPool;

  const db = new Proxy(actual.db, {
    get(_, property) {
      tagAccess();
      // Inside a transaction scope `db` IS the scope's transaction (the real
      // proxy resolves it, and reports the access itself); outside one a
      // request's statements take the calibra_app pool.
      if (context.getStore() && !currentTransactionScope()) {
        observer?.onAccess?.();
        return Reflect.get(appPool().db, property);
      }
      return Reflect.get(actual.db, property);
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
    setQueryObserver: (next: QueryObserver | null) => {
      observer = next;
      actual.setQueryObserver(next);
    },
    getDb: () => {
      tagAccess();
      if (!context.getStore()) return actual.getDb();
      observer?.onAccess?.();
      return appPool().db;
    },
  };
}

/**
 * Per worker database (call after DATABASE_URL points at it), in report mode only:
 * swap the policies for the probing variant (see the header).
 */
export async function installReportProbes(): Promise<void> {
  if (!appRoleEnabled() || !reportEnabled()) return;
  const url = process.env.DATABASE_URL;
  assertHarnessWorkerDb(url);
  if (!url) throw new Error("app-role: DATABASE_URL is not set");
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
