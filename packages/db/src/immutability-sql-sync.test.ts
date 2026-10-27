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

    // Everything after the escape-hatch function is shared. The hatch function
    // itself is redefined by migration 0130 (gated on the table owner), so the
    // extras carry that newer version; it is checked below.
    const shared = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION calibra_append_only"),
    );
    expect(shared).toContain("calibra_append_only");
    expect(shared).toContain("calibra_calibration_job_guard");
    expect(extras).toContain(shared);
  });

  it("schema-extras.sql carries the owner-gated escape-hatch functions of migration 0130", () => {
    const migration = normalized(
      "../drizzle/0130_evidence_privileges_owner_hatch.sql",
    );
    const extras = normalized("../sql/schema-extras.sql");
    const hatch = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION calibra_session_is_owner"),
      migration.indexOf(
        "CREATE OR REPLACE FUNCTION calibra_calibration_job_status_guard",
      ),
    );
    expect(hatch).toContain("calibra_history_rewrite_allowed");
    expect(hatch).toContain("calibra_org_purge_allowed");
    const statements = hatch.split(/(?=CREATE OR REPLACE FUNCTION)/);
    expect(statements).toHaveLength(3);
    for (const statement of statements) {
      expect(extras).toContain(statement.trim());
    }
  });
});
