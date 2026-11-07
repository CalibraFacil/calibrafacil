import type { OrgDb } from "@calibra-facil/db/for-org";
import { personnelCompetence } from "@calibra-facil/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { notFound } from "../../lib/domain-errors";

/**
 * The laboratory's live (not soft-deleted) personnel competence. Throws 404
 * when none of this laboratory matches.
 */
export async function requireLabCompetence(
  id: number,
  labOrganizationId: string,
  o: Pick<OrgDb, "select">,
) {
  const [found] = await o
    .select()
    .from(personnelCompetence)
    .where(
      and(
        eq(personnelCompetence.id, id),
        eq(personnelCompetence.organizationId, labOrganizationId),
        isNull(personnelCompetence.deletedAt),
      ),
    )
    .limit(1);
  if (!found) throw notFound("not_found", "Competência não encontrada");
  return found;
}
