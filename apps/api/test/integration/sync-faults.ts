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
