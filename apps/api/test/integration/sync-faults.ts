import { sql } from "drizzle-orm";
import { db } from "@calibra-facil/db";

// Harness: forced failures for the desktop sync specs. Statements issued here
// are skipped by the tenant SQL guard (test/integration/ is classified as harness).

/** A temporary trigger that makes the audit row of ONE event fail to insert. */
export async function failEventAuditInsert(eventId: string) {
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION sp_test_fail_event_audit() RETURNS trigger AS $$
    BEGIN
      IF NEW.details->>'eventId' = ${sql.raw(`'${eventId}'`)} THEN
        RAISE EXCEPTION 'sp_test: organization_event_log insert forced to fail';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await db.execute(sql`
    CREATE TRIGGER sp_test_fail_event_audit
    BEFORE INSERT ON organization_event_log
    FOR EACH ROW EXECUTE FUNCTION sp_test_fail_event_audit()
  `);
  return async () => {
    await db.execute(
      sql`DROP TRIGGER IF EXISTS sp_test_fail_event_audit ON organization_event_log`,
    );
    await db.execute(sql`DROP FUNCTION IF EXISTS sp_test_fail_event_audit()`);
  };
}

/**
 * A temporary trigger that makes the "applied" record of ONE event fail to write: the
 * change and its audit rows succeed, the transaction then fails at the claim's completion.
 */
export async function failAppliedEventCompletion(eventId: string) {
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION sp_test_fail_event_claim() RETURNS trigger AS $$
    BEGIN
      IF NEW.event_id = ${sql.raw(`'${eventId}'`)} AND NEW.applied_at IS NOT NULL THEN
        RAISE EXCEPTION 'sp_test: sync_applied_event completion forced to fail';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await db.execute(sql`
    CREATE TRIGGER sp_test_fail_event_claim
    BEFORE UPDATE ON sync_applied_event
    FOR EACH ROW EXECUTE FUNCTION sp_test_fail_event_claim()
  `);
  return async () => {
    await db.execute(
      sql`DROP TRIGGER IF EXISTS sp_test_fail_event_claim ON sync_applied_event`,
    );
    await db.execute(sql`DROP FUNCTION IF EXISTS sp_test_fail_event_claim()`);
  };
}
