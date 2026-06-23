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
 */
export async function truncateAll(): Promise<void> {
  // Last line of defense: never TRUNCATE a non-local/Neon database.
  assertEphemeralTestDb(process.env.DATABASE_URL);
  const result = await db.execute(
    sql`select tablename from pg_tables where schemaname = 'public' and tablename <> '__drizzle_migrations'`,
  );
  const tables = rowsOf(result)
    .map((row) => row.tablename)
    .filter((name): name is string => typeof name === "string");

  if (tables.length === 0) return;

  const list = tables.map((name) => `"${name}"`).join(", ");
  await db.execute(sql.raw(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`));
}

export { db };
