import type { OrgDb } from "@calibra-facil/db/for-org";
import { calibrationVisit } from "@calibra-facil/db/schema";
import { and, eq } from "drizzle-orm";
import { notFound } from "../../lib/domain-errors";
import { buildUnitScopeCondition } from "../../lib/units";
import type { AuthVariables } from "../../middleware/permission";

/**
 * The laboratory's visit scoped to the caller's organization and units. Throws
 * 404 when no visit of theirs has the id. `o` is the caller's org-bound handle
 * (row-level security).
 */
export async function requireScopedVisit(
  id: number,
  member: AuthVariables["member"],
  o: Pick<OrgDb, "select">,
) {
  const [visit] = await o
    .select()
    .from(calibrationVisit)
    .where(
      and(
        eq(calibrationVisit.id, id),
        eq(calibrationVisit.organizationId, member.organizationId),
        buildUnitScopeCondition(calibrationVisit.unitId, member),
      ),
    )
    .limit(1);
  if (!visit) throw notFound("visit_not_found", "Visita nao encontrada");
  return visit;
}
