import { db } from "@calibra-facil/db";
import { sql } from "drizzle-orm";
import { assertEphemeralTestDb } from "./guard";

// Reuse the REAL db singleton (pointed at the test Postgres by setup.ts) — never
// open a second pool.

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result;
  if (result && typeof result === "object" && "rows" in result) {
    const { rows } = result;
    return Array.isArray(rows) ? rows : [];
  }
  return [];
}

/**
 * Wipe every public table between tests for isolation. TRUNCATE ... RESTART
 * IDENTITY CASCADE resets serial ids too. Excludes the drizzle bookkeeping table.
 *
 * FIX A — truncate ONLY non-empty tables.
 *
 * Naive approach: TRUNCATE all ~131 tables every time → ~5-6 s even when a test
 * dirtied only 3-4 tables, because PG must acquire exclusive locks + reset every
 * sequence regardless.
 *
 * Optimized: build a single SQL statement that uses EXISTS to check each table
 * and returns only the names of tables that actually have rows. EXISTS on an
 * empty table is essentially free (PG bails on the first page miss). We then
 * TRUNCATE only the non-empty subset — usually 4-8 tables per test instead of
 * 131, making beforeEach 10-30× faster in practice.
 *
 * Correctness: "EXISTS(SELECT 1 FROM t)" is an exact scan — it cannot return a
 * false negative (unlike pg_class.reltuples / pg_stat_user_tables.n_live_tup
 * which are stale estimates). After truncateAll() every public table is empty
 * — identical isolation guarantee to the naive approach.
 */
export async function truncateAll(): Promise<void> {
  // Last line of defense: never TRUNCATE a non-local/Neon database.
  assertEphemeralTestDb(process.env.DATABASE_URL);

  // Step 1: discover all public tables (except drizzle bookkeeping).
  const listResult = await db.execute(
    sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '__drizzle_migrations'`,
  );
  const tables = rowsOf(listResult)
    .map((row) => row.tablename)
    .filter((name): name is string => typeof name === "string");

  if (tables.length === 0) return;

  // Step 2: in ONE round-trip, find which tables actually have rows.
  // Build: SELECT 't1' AS t WHERE EXISTS(SELECT 1 FROM "t1")
  //   UNION ALL SELECT 't2' WHERE EXISTS(SELECT 1 FROM "t2") …
  // This is safe: table names come from pg_tables (system catalog), not user
  // input, so no SQL-injection risk despite raw interpolation here.
  const existsUnion = tables
    .map((name) => `SELECT '${name}' AS t WHERE EXISTS(SELECT 1 FROM "${name}")`)
    .join(" UNION ALL ");

  const existsResult = await db.execute(sql.raw(existsUnion));
  const nonEmpty = rowsOf(existsResult)
    .map((row) => row.t)
    .filter((name): name is string => typeof name === "string");

  if (nonEmpty.length === 0) return;

  // Step 3: truncate only the non-empty tables.
  const list = nonEmpty.map((name) => `"${name}"`).join(", ");
  await db.execute(sql.raw(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`));
}

export { db };
