import type { OrgDb } from "@calibra-facil/db/for-org";
import { calibrationRequest } from "@calibra-facil/db/schema";
import { and, eq } from "drizzle-orm";
import { notFound } from "../../lib/domain-errors";
import { buildUnitScopeCondition } from "../../lib/units";
import type { MemberData } from "../../middleware/permission";

/**
 * The laboratory's calibration request scoped to the caller's organization and
 * units, its row locked (`FOR UPDATE`) until the transaction ends: the state
 * changes (review, approve, reject, convert) judge its status under the lock.
 * Throws 404 when no request of theirs has the id.
 */
export async function requireLockedLabRequest(
  id: number,
  member: MemberData,
  o: Pick<OrgDb, "select">,
) {
  const [request] = await o
    .select({
      id: calibrationRequest.id,
      status: calibrationRequest.status,
      reviewedBy: calibrationRequest.reviewedBy,
      reviewedAt: calibrationRequest.reviewedAt,
      customerId: calibrationRequest.customerId,
      unitId: calibrationRequest.unitId,
      deliveryMethod: calibrationRequest.deliveryMethod,
      onsiteAddress: calibrationRequest.onsiteAddress,
    })
    .from(calibrationRequest)
    .where(
      and(
        eq(calibrationRequest.id, id),
        eq(calibrationRequest.organizationId, member.organizationId),
        buildUnitScopeCondition(calibrationRequest.unitId, member),
      ),
    )
    .limit(1)
    .for("update");
  if (!request) {
    throw notFound("request_not_found", "Solicitacao nao encontrada");
  }
  return request;
}
