// Conditionally load dotenv in Node.js environments (not needed in CF Workers)
if (typeof process !== "undefined" && process.env.NODE_ENV !== "production") {
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

type Database =
  | NeonDatabase<typeof schema>
  | ReturnType<typeof drizzlePostgres<typeof schema>>;

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

function createPostgresJsDatabase(connectionString: string) {
  const configuredMax = Number(process.env.DATABASE_POOL_MAX ?? 5);
  const sql = postgres(connectionString, {
    max:
      Number.isFinite(configuredMax) && configuredMax > 0 ? configuredMax : 5,
    fetch_types: false,
  });
  return drizzlePostgres(sql, { schema });
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
  const isProduction = process.env.NODE_ENV === "production";
  const isCloudflare = isCloudflareWorkersRuntime();

  // Prefer direct DATABASE_URL in development to avoid Hyperdrive local overhead.
  const databaseUrl = process.env.DATABASE_URL;
  if (!isProduction && databaseUrl) {
    return cacheDatabase(`database:${databaseUrl}`, () => {
      if (isCloudflare) return createNeonServerlessDatabase(databaseUrl);
      return createPostgresJsDatabase(databaseUrl);
    });
  }

  // Hyperdrive - use postgres.js driver (recommended by Cloudflare and Neon)
  const hyperdriveUrl = process.env.HYPERDRIVE_URL;
  if (hyperdriveUrl) {
    return cacheDatabase(`hyperdrive:${hyperdriveUrl}`, () =>
      createPostgresJsDatabase(hyperdriveUrl),
    );
  }

  // Fallback to direct DATABASE_URL when Hyperdrive is not available
  if (databaseUrl) {
    return cacheDatabase(`database:${databaseUrl}`, () => {
      if (isCloudflare) return createNeonServerlessDatabase(databaseUrl);
      return createPostgresJsDatabase(databaseUrl);
    });
  }

  throw new Error(
    "No database connection configured. Set HYPERDRIVE_URL or DATABASE_URL.",
  );
}

// For backwards compatibility - creates a fresh request-safe DB instance on access.
const dbProxyTarget: Database = Object.create(null);

export const db = new Proxy(dbProxyTarget, {
  get(_, prop) {
    return Reflect.get(getDb(), prop);
  },
});
