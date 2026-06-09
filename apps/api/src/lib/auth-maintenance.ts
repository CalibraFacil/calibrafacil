import { lt } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import { session, verification } from "@calibra-facil/db/schema";

/**
 * Delete expired Better Auth rows. Expired sessions/verifications are already
 * rejected at read time, so this is hygiene (table growth), not enforcement.
 * Sign-ins are independently recorded in platform_event_log, so removing
 * expired session rows does not erase the audit trail. Swept weekly by the
 * auth-maintenance cron; both tables carry an expires_at index (migration
 * 0049) so the sweep stays cheap.
 */
export async function cleanupExpiredAuthRecords(now = new Date()) {
  const expiredSessions = await db
    .delete(session)
    .where(lt(session.expiresAt, now))
    .returning();

  const expiredVerifications = await db
    .delete(verification)
    .where(lt(verification.expiresAt, now))
    .returning();

  return {
    deletedSessions: expiredSessions.length,
    deletedVerifications: expiredVerifications.length,
  };
}
