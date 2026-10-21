import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Migration 0115 creates the immutability functions and triggers; a database
 * built from schema.ts gets the same objects from sql/schema-extras.sql. The two
 * files repeat the same SQL on purpose (a migration is forward-only, the extras
 * file is rebuilt), so this guard fails when one is edited without the other.
 */
function normalized(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
}

describe("immutability SQL: migration 0115 and schema-extras.sql", () => {
  it("schema-extras.sql repeats every function and trigger the migration creates", () => {
    const migration = normalized("../drizzle/0115_db_immutability.sql");
    const extras = normalized("../sql/schema-extras.sql");

    // Everything after the foreign-key drop (the first statement) is shared.
    const shared = migration.slice(
      migration.indexOf(
        "CREATE OR REPLACE FUNCTION calibra_history_rewrite_allowed",
      ),
    );
    expect(shared).toContain("calibra_append_only");
    expect(shared).toContain("calibra_calibration_job_guard");
    expect(extras).toContain(shared);
  });
});
