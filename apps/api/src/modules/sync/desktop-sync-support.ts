import { type SyncEvent } from "@calibra-facil/contracts";
import { db } from "@calibra-facil/db";
import { member, organizationEventLog } from "@calibra-facil/db/schema";
import { and, asc, eq, sql } from "drizzle-orm";
import { writeOrganizationAuditEvent } from "../../lib/audit";
import { type MemberData } from "../../middleware/permission";
import { asRecord, getNullableString } from "./helpers";
import { type ApplyDesktopSyncEventInput } from "./desktop-event-support";

export async function findDesktopSyncRemoteEntityId(
  organizationId: string,
  localEntityId: string,
) {
  // Filter in SQL on the key itself. An entity can have far more audit rows
  // than any page, most of them without a remote id (updates, retries); an
  // unordered LIMIT over all of them could miss the row that maps the local id
  // to its cloud row, and the create was then applied a second time. The
  // oldest mapping wins, which is the one the entity was created with.
  const [row] = await db
    .select({
      details: organizationEventLog.details,
    })
    .from(organizationEventLog)
    .where(
      and(
        eq(organizationEventLog.organizationId, organizationId),
        eq(organizationEventLog.entityId, localEntityId),
        sql`${organizationEventLog.details}->>'remoteEntityId' IS NOT NULL`,
      ),
    )
    .orderBy(asc(organizationEventLog.id))
    .limit(1);

  if (!row) return null;

  const remoteEntityId = asRecord(row.details).remoteEntityId;
  return typeof remoteEntityId === "number" ||
    typeof remoteEntityId === "string"
    ? remoteEntityId
    : null;
}

export async function findAppliedDesktopSyncEvent(
  organizationId: string,
  event: SyncEvent,
) {
  const rows = await db
    .select({
      details: organizationEventLog.details,
    })
    .from(organizationEventLog)
    .where(
      and(
        eq(organizationEventLog.organizationId, organizationId),
        eq(organizationEventLog.entityId, event.entityId),
        // Filter on the op id in SQL: an entity can have far more audit rows
        // than the page below, and an unordered LIMIT would miss the one that
        // proves this event was already applied (a retried push re-applied).
        sql`${organizationEventLog.details}->>'eventId' = ${event.eventId}`,
      ),
    )
    .limit(100);

  for (const row of rows) {
    const details = asRecord(row.details);
    if (details.eventId !== event.eventId) continue;

    const remoteEntityId = details.remoteEntityId;
    return {
      remoteEntityId:
        typeof remoteEntityId === "number" || typeof remoteEntityId === "string"
          ? remoteEntityId
          : undefined,
      remoteEntity: details.remoteEntity,
    };
  }

  return null;
}

export async function getRemoteServiceOrderIdFromPayload(
  input: ApplyDesktopSyncEventInput,
  payload: Record<string, unknown>,
) {
  const localServiceOrderId = getNullableString(payload, "serviceOrderId");
  if (!localServiceOrderId) return null;

  return findDesktopSyncRemoteEntityId(
    input.memberData.organizationId,
    localServiceOrderId,
  );
}

export async function writeDesktopSyncAudit(
  input: ApplyDesktopSyncEventInput,
  actorUserId: string,
  details: Record<string, unknown> = {},
) {
  const claimedActorUserId = getClaimedSyncActorUserId(input.event.actorUserId);
  await writeOrganizationAuditEvent({
    organizationId: input.memberData.organizationId,
    unitId: input.event.unitId,
    actorUserId,
    actorMemberId: input.memberData.id,
    action: `desktop_sync.${input.event.operation}`,
    entityType: input.event.entityType,
    entityId: input.event.entityId,
    details: {
      eventId: input.event.eventId,
      deviceId: input.deviceId,
      clientBatchId: input.clientBatchId,
      idempotencyKey: input.event.idempotencyKey,
      localVersion: input.event.localVersion,
      payload: input.event.payload,
      localEntityId: input.event.entityId,
      // The offline-actor claim is metadata only (validated as an org member
      // at push time, never trusted as identity): keep any discrepancy visible.
      ...(claimedActorUserId !== null && claimedActorUserId !== actorUserId
        ? { claimedActorUserId }
        : {}),
      ...details,
    },
  });
}

export function getClaimedSyncActorUserId(
  actorUserId: string | null | undefined,
) {
  const claimed = actorUserId?.trim();
  return claimed && claimed !== "local" ? claimed : null;
}

async function isOrganizationMemberUser(
  userId: string,
  organizationId: string,
) {
  const [record] = await db
    .select({ id: member.id })
    .from(member)
    .where(
      and(eq(member.userId, userId), eq(member.organizationId, organizationId)),
    )
    .limit(1);

  return Boolean(record);
}

/**
 * Desktop sync events carry a client-asserted actorUserId (who performed the
 * work offline). The pushing session proves org/unit scope, but the actor id
 * itself must not be taken on faith: an arbitrary value would let a tampered
 * client attribute creations/executions/approvals to someone else in the
 * audit trail. Policy: the claimed actor must be the authenticated user or a
 * member of the active organization (device-handoff case); anything else is
 * rejected. When the claimed actor differs from the pushing user, audit
 * entries additionally record pushedByUserId so the discrepancy stays
 * visible.
 */
export async function validateSyncActorScope(
  claimedActorUserId: string | null,
  memberData: MemberData,
  sessionUserId: string,
  cache?: Map<string, boolean>,
) {
  if (!claimedActorUserId || claimedActorUserId === sessionUserId) {
    return true;
  }

  let isMember = cache?.get(claimedActorUserId);
  if (isMember === undefined) {
    isMember = await isOrganizationMemberUser(
      claimedActorUserId,
      memberData.organizationId,
    );
    cache?.set(claimedActorUserId, isMember);
  }

  return isMember;
}
