import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@calibra-facil/db";

/**
 * Harness guard. The integration template must carry every object of
 * packages/db/sql/schema-extras.sql, the same file `db:bootstrap` applies in
 * production. Before this guard the harness applied only a slice of it, so the
 * one-default-per-organization unique indexes were missing in tests and a second
 * default that production rejects (500) passed here. If a harness edit drops the
 * file again, these assertions fail.
 */
describe("integration template carries schema-extras.sql (harness guard)", () => {
  it("REQ-HARNESS-001: the org-default partial unique indexes exist as UNIQUE partial indexes", async () => {
    const rows = await db.execute<{ indexname: string; indexdef: string }>(sql`
      select indexname, indexdef from pg_indexes
       where schemaname = 'public'
         and indexname in (
           'certificate_release_policy_org_default_uidx',
           'automatic_send_rule_org_default_uidx'
         )
       order by indexname`);
    const list = Array.from(rows);

    expect(list.map((row) => row.indexname)).toEqual([
      "automatic_send_rule_org_default_uidx",
      "certificate_release_policy_org_default_uidx",
    ]);
    for (const row of list) {
      expect(row.indexdef).toMatch(/CREATE UNIQUE INDEX/);
      expect(row.indexdef).toMatch(/WHERE/);
    }
  });

  it("REQ-HARNESS-001: the extensions, the unaccent wrapper and the regulated-invariant trigger exist", async () => {
    const extensions = await db.execute<{ extname: string }>(sql`
      select extname from pg_extension where extname in ('unaccent', 'pg_trgm')
       order by extname`);
    expect(Array.from(extensions).map((row) => row.extname)).toEqual([
      "pg_trgm",
      "unaccent",
    ]);

    const fn = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from pg_proc
       where proname = 'immutable_unaccent'`);
    expect(Array.from(fn)[0]?.n).toBe(1);

    const trigger = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from pg_trigger
       where tgname = 'calibration_job_immutable_guard' and not tgisinternal`);
    expect(Array.from(trigger)[0]?.n).toBe(1);
  });
});
