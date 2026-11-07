import type { OrgDb } from "@calibra-facil/db/for-org";
import { organizationEventLog } from "@calibra-facil/db/schema";

export async function writeOrganizationAuditEvent(
  params: {
    organizationId: string;
    actorUserId?: string | null;
    actorMemberId?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    unitId?: number | null;
    details?: Record<string, unknown> | null;
  },
  /**
   * The handle the row is written through: the caller's org-bound transaction
   * (`ctx.o` of a `withOrg`), so the event is written in the same transaction
   * and under the same organization setting (row-level security).
   */
  executor: Pick<OrgDb, "insert">,
) {
  await executor.insert(organizationEventLog).values({
    organizationId: params.organizationId,
    unitId: params.unitId ?? null,
    actorUserId: params.actorUserId ?? null,
    actorMemberId: params.actorMemberId ?? null,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId ?? null,
    details: params.details ?? null,
  });
}
