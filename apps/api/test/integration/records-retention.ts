import { db } from "@calibra-facil/db";
import { organization } from "@calibra-facil/db/schema";
import { eq, sql } from "drizzle-orm";

/**
 * Hard-deletes an organization the way the purge job does: in one transaction
 * that opts in with `calibra.allow_org_purge` (migration 0117, REQ-RET-3).
 * Without it Postgres refuses `DELETE FROM organization` for a LAB
 * organization. Test-only: the specs that assert "evidence survives the
 * deletion of its organization" use it to get past the guard and reach the
 * foreign keys.
 */
export async function hardDeleteOrganizationAsPurge(
  organizationId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('calibra.allow_org_purge', 'on', true)`,
    );
    await tx.delete(organization).where(eq(organization.id, organizationId));
  });
}
