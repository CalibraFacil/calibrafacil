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
  currentTransactionScope,
  transactionScopeStorage,
} from "./transaction-scope.js";

export { afterTransactionCommit } from "./transaction-scope.js";

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

let cachedDatabase: { key: string; database: Database } | null = null;

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
  const isCloudflare = isCloudflareWorkersRuntime();

  // Prefer direct DATABASE_URL in development to avoid Hyperdrive local overhead.
  const databaseUrl = config.url;
  if (!isProduction && databaseUrl) {
    return cacheDatabase(`database:${databaseUrl}`, () => {
      if (isCloudflare) return createNeonServerlessDatabase(databaseUrl);
      return createPostgresJsDatabase(databaseUrl, config.poolMax);
    });
  }

  // Hyperdrive - use postgres.js driver (recommended by Cloudflare and Neon)
  const hyperdriveUrl = config.hyperdriveUrl;
  if (hyperdriveUrl) {
    return cacheDatabase(`hyperdrive:${hyperdriveUrl}`, () =>
      createPostgresJsDatabase(hyperdriveUrl, config.poolMax),
    );
  }

  // Fallback to direct DATABASE_URL when Hyperdrive is not available
  if (databaseUrl) {
    return cacheDatabase(`database:${databaseUrl}`, () => {
      if (isCloudflare) return createNeonServerlessDatabase(databaseUrl);
      return createPostgresJsDatabase(databaseUrl, config.poolMax);
    });
  }

  throw new Error(
    "No database connection configured. Set HYPERDRIVE_URL or DATABASE_URL.",
  );
}

const SCOPE_CALLBACK_NAME = "scopedTransaction";

/**
 * Whether `callback` is the one a transaction scope hands to
 * `db.transaction`. A test seam: the integration harness that forces the
 * interleaving of a lost compare-and-set must wait for the write's own
 * transaction, which inside a scope is a savepoint and not this one.
 */
export function isTransactionScopeCallback(
  callback: (...args: never[]) => unknown,
): boolean {
  return callback.name === SCOPE_CALLBACK_NAME;
}

/**
 * Runs `work` in ONE database transaction that every `db` access in its async
 * call chain joins (see transaction-scope.ts). It commits when `work` resolves
 * and rolls back, discarding the deferred `afterTransactionCommit` callbacks,
 * when it throws. Called inside a scope it just runs `work`: the outer
 * transaction owns the commit.
 */
export async function runInTransactionScope<T>(
  work: () => Promise<T>,
): Promise<T> {
  if (currentTransactionScope()) return work();

  const afterCommit: Array<() => void | Promise<void>> = [];
  const result = await getDb().transaction(
    async function scopedTransaction(tx) {
      const scope = { tx, afterCommit, closed: false };
      try {
        return await transactionScopeStorage.run(scope, work);
      } finally {
        scope.closed = true;
      }
    },
  );
  for (const callback of afterCommit) {
    try {
      await callback();
    } catch (error) {
      console.error("[db] An after-commit callback failed:", error);
    }
  }
  return result;
}

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
