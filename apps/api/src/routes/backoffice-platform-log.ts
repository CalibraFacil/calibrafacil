import { db } from "@calibra-facil/db";
import { platformEventLog } from "@calibra-facil/db/schema";

/**
 * Append-only audit row for backoffice/platform actions. Shared by the
 * backoffice router and its extracted sub-routers (e.g. organizations) so the
 * exact same audit write is used everywhere without a parent↔child import cycle.
 */
export async function logPlatformEvent(params: {
  actorUserId?: string | null;
  targetUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  details?: Record<string, unknown> | null;
}) {
  await db.insert(platformEventLog).values({
    actorUserId: params.actorUserId ?? null,
    targetUserId: params.targetUserId ?? null,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId ?? null,
    details: params.details ?? null,
  });
}
