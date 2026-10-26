import { readDatabaseConfig } from "@calibra-facil/config";

// Conditionally load dotenv in Node.js environments (not needed in CF Workers)
if (
  typeof process !== "undefined" &&
  readDatabaseConfig().nodeEnv !== "production"
) {
  try {
    await import("dotenv/config");
  } catch {
    // dotenv not available, likely running in CF Workers
  }
}

import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import {
  drizzle as drizzleNeon,
  type NeonDatabase,
} from "drizzle-orm/neon-serverless";
import postgres from "postgres";
import { Pool } from "@neondatabase/serverless";
import * as schema from "./schema.js";
import {
  createTransactionScopeRunner,
  currentTransactionScope,
} from "./transaction-scope.js";

export {
  afterTransactionCommit,
  isInTransactionScope,
} from "./transaction-scope.js";

type Database =
  | NeonDatabase<typeof schema>
  | ReturnType<typeof drizzlePostgres<typeof schema>>;

/**
 * Test-only statement observer. Off by default: with no observer installed the
 * hooks below are no-ops, so production behaviour is unchanged. The API
 * integration tier installs one to assert every tenant-table statement carries
 * an organization predicate (see apps/api/test/integration/tenant-sql-guard.ts).
 *
 * - `onAccess` runs synchronously whenever calling code obtains the database
 *   (`db.<member>` or `getDb()`), i.e. while the caller's stack is still live,
 *   so an observer can attribute the statements that follow to their call site.
 * - `onQuery` receives every SQL statement (parameterized text) at execution.
 */
export type QueryObserver = {
  onAccess?: () => void;
  onQuery: (query: string, params: unknown[]) => void;
};

let queryObserver: QueryObserver | null = null;

export function setQueryObserver(observer: QueryObserver | null): void {
  queryObserver = observer;
}

const observingLogger = {
  logQuery(query: string, params: unknown[]) {
    queryObserver?.onQuery(query, params);
  },
};

type CachedDatabase = { key: string; database: Database };
let cachedDatabase: CachedDatabase | null = null;
// The system path's own pool (`DATABASE_OWNER_URL`): a second slot, so asking for
// it never evicts the application pool and the other way round.
let cachedSystemDatabase: CachedDatabase | null = null;

/** Both drivers keep their client on `$client` (postgres.js `Sql`, Neon `Pool`): each can `end()`. */
async function closeDatabase(database: Database): Promise<void> {
  const client: unknown = Reflect.get(database, "$client");
  if (client && typeof client === "object" && "end" in client) {
    const end: unknown = client.end;
    if (typeof end === "function") await Reflect.apply(end, client, []);
  }
}

/**
 * Closes the connection pools this process opened (the application pool and the
 * system path's), for a graceful shutdown: once nothing runs, release the
 * connections instead of leaving the server to reap them. A later `db` access
 * opens a new pool. Idempotent.
 */
export async function closeDatabases(): Promise<void> {
  const open = [cachedDatabase, cachedSystemDatabase];
  cachedDatabase = null;
  cachedSystemDatabase = null;
  await Promise.all(
    open.map((entry) => entry && closeDatabase(entry.database)),
  );
}

function isCloudflareWorkersRuntime() {
  return (
    typeof navigator !== "undefined" &&
    navigator.userAgent === "Cloudflare-Workers"
  );
}

function cacheDatabase(key: string, createDatabase: () => Database): Database {
  if (isCloudflareWorkersRuntime()) {
    return createDatabase();
  }

  if (cachedDatabase?.key === key) {
    return cachedDatabase.database;
  }

  const database = createDatabase();
  cachedDatabase = { key, database };
  return database;
}

function cacheSystemDatabase(
  key: string,
  createDatabase: () => Database,
): Database {
  if (isCloudflareWorkersRuntime()) {
    return createDatabase();
  }

  if (cachedSystemDatabase?.key === key) {
    return cachedSystemDatabase.database;
  }

  const database = createDatabase();
  cachedSystemDatabase = { key, database };
  return database;
}

function createPostgresJsDatabase(connectionString: string, poolMax: number) {
  const sql = postgres(connectionString, {
    max: poolMax,
    fetch_types: false,
  });
  return drizzlePostgres(sql, { schema, logger: observingLogger });
}

function createNeonServerlessDatabase(connectionString: string) {
  const pool = new Pool({ connectionString });
  return drizzleNeon(pool, { schema });
}

/**
 * Creates a fresh database connection.
 *
 * Uses different drivers based on environment:
 * - HYPERDRIVE_URL: Uses postgres.js driver (recommended for Cloudflare Hyperdrive)
 * - DATABASE_URL in Bun/Node: Uses postgres.js with a cached connection pool
 * - DATABASE_URL in Cloudflare: Uses Neon serverless driver as a Workers-safe fallback
 *
 * @see https://neon.com/docs/guides/cloudflare-hyperdrive
 * @see https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/drizzle-orm/
 */
export function getDb(): Database {
  queryObserver?.onAccess?.();
  const config = readDatabaseConfig();
  const isProduction = config.nodeEnv === "production";
  // Guard (development and test only): the instance is the pool, not the open
  // transaction. Code that asks for it while a transaction scope is open (a
  // library that builds its own adapter, as better-auth does) works on a second
  // connection: with a pool of one it waits for the connection the scope holds,
  // forever, and what it writes survives a rollback of the scope. Run such work
  // before the scope, or after it (`afterTransactionCommit`).
  if (!isProduction && currentTransactionScope()) {
    throw new Error(
      "getDb() was called inside a transaction scope: that is a second database connection. Do the work before the scope opens or in afterTransactionCommit.",
    );
  }
  const isCloudflare = isCloudflareWorkersRuntime();

  // Prefer direct DATABASE_URL in development to avoid Hyperdrive local overhead.
  const databaseUrl = config.url;
  if (!isProduction && databaseUrl) {
    return cacheDatabase(`database:${databaseUrl}:${config.poolMax}`, () => {
      if (isCloudflare) return createNeonServerlessDatabase(databaseUrl);
      return createPostgresJsDatabase(databaseUrl, config.poolMax);
    });
  }

  // Hyperdrive - use postgres.js driver (recommended by Cloudflare and Neon)
  const hyperdriveUrl = config.hyperdriveUrl;
  if (hyperdriveUrl) {
    return cacheDatabase(`hyperdrive:${hyperdriveUrl}:${config.poolMax}`, () =>
      createPostgresJsDatabase(hyperdriveUrl, config.poolMax),
    );
  }

  // Fallback to direct DATABASE_URL when Hyperdrive is not available
  if (databaseUrl) {
    return cacheDatabase(`database:${databaseUrl}:${config.poolMax}`, () => {
      if (isCloudflare) return createNeonServerlessDatabase(databaseUrl);
      return createPostgresJsDatabase(databaseUrl, config.poolMax);
    });
  }

  throw new Error(
    "No database connection configured. Set HYPERDRIVE_URL or DATABASE_URL.",
  );
}

/**
 * The SYSTEM path (P2-18): the connection of the table owner, for the statements
 * that are cross-organization by design and so cannot run under a policy that
 * names one organization per transaction (`calibra.organization_id`, migration
 * 0123): the lookup that LEARNS the laboratory of a request (portal host name,
 * the portal scope resolver, a session's memberships), reads over a bounded SET
 * of laboratories, and writes to the global `asset_type` catalog (a trigger fans
 * them out to every laboratory's change log, which `calibra_app` may not do).
 *
 * `DATABASE_OWNER_URL` names that connection. Unset, the system path IS the
 * application connection: while `DATABASE_RLS_MODE=shadow` the application
 * connects as the owner, so there is nothing to split yet. Set it together with
 * the role split (DEPLOYMENT.md, "Row-level security").
 *
 * Every use is named (`systemDb`) and carries a comment saying why; routes may
 * not import it (the `no-raw-db-in-routes` rule), only lib modules may, and each
 * is a reviewed entry of tenant-sql-allowlist.ts. It deliberately ignores a
 * transaction scope: it is another connection by design.
 */
export function getSystemDb(): Database {
  const config = readDatabaseConfig();
  const ownerUrl = config.ownerUrl;
  // Unset: the application connection. `getDb()` reports the access itself, so
  // the observer sees exactly one access per call on either branch.
  if (!ownerUrl) return getDb();
  queryObserver?.onAccess?.();
  const isCloudflare = isCloudflareWorkersRuntime();
  return cacheSystemDatabase(`owner:${ownerUrl}:${config.poolMax}`, () => {
    if (isCloudflare) return createNeonServerlessDatabase(ownerUrl);
    return createPostgresJsDatabase(ownerUrl, config.poolMax);
  });
}

/** `getSystemDb()` as a stable import, like `db` for the application pool. */
const systemProxyTarget: Database = Object.create(null);

export const systemDb = new Proxy(systemProxyTarget, {
  get(_, prop) {
    return Reflect.get(getSystemDb(), prop);
  },
});

/**
 * Runs `work` in ONE database transaction that every `db` access in its async
 * call chain joins (see transaction-scope.ts). It commits when `work` resolves
 * and rolls back, discarding the deferred `afterTransactionCommit` callbacks,
 * when it throws. Called inside a scope it just runs `work`: the outer
 * transaction owns the commit.
 */
export const runInTransactionScope = createTransactionScopeRunner((callback) =>
  getDb().transaction(callback),
);

// For backwards compatibility - creates a fresh request-safe DB instance on access.
// Inside `runInTransactionScope` it resolves to the open transaction instead.
const dbProxyTarget: Database = Object.create(null);

export const db = new Proxy(dbProxyTarget, {
  get(_, prop) {
    const scope = currentTransactionScope();
    if (scope) {
      queryObserver?.onAccess?.();
      const member = Reflect.get(scope.tx, prop);
      // Bound to the transaction, not to this proxy: drizzle reads its own
      // members (`this.session`) while building a query, and each of those
      // reads would otherwise come back through here.
      return typeof member === "function" ? member.bind(scope.tx) : member;
    }
    return Reflect.get(getDb(), prop);
  },
});
