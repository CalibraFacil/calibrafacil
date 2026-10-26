import { type SyncEvent } from "@calibra-facil/contracts";
import type { OrgExecutor } from "@calibra-facil/db/for-org";
import {
  member,
  organizationEventLog,
  syncAppliedEvent,
} from "@calibra-facil/db/schema";
import { and, asc, eq, sql } from "drizzle-orm";
import { writeOrganizationAuditEvent } from "../../lib/audit";
import { orgDb } from "../../lib/org-db";
import { withOrgReader } from "../../lib/org-transaction";
import { type MemberData } from "../../middleware/permission";
import { asRecord, getNullableString } from "./helpers";
import { type ApplyDesktopSyncEventInput } from "./desktop-event-support";

/**
 * A read of the laboratory's audit log. Inside the event's transaction the
 * caller passes its handle (`input.o`); before it (the pre-phase of a push)
 * there is none and the read opens a short transaction that names the laboratory.
 */
type AuditLogReader = Pick<OrgExecutor, "select">;

export async function findDesktopSyncRemoteEntityId(
  organizationId: string,
  localEntityId: string,
  executor?: AuditLogReader,
) {
  // Filter in SQL on the key itself. An entity can have far more audit rows
  // than any page, most of them without a remote id (updates, retries); an
  // unordered LIMIT over all of them could miss the row that maps the local id
  // to its cloud row, and the create was then applied a second time. The
  // oldest mapping wins, which is the one the entity was created with.
  const [row] = await withOrgReader(organizationId, executor, (reader) =>
    reader
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
      .limit(1),
  );

  if (!row) return null;

  const remoteEntityId = asRecord(row.details).remoteEntityId;
  return typeof remoteEntityId === "number" ||
    typeof remoteEntityId === "string"
    ? remoteEntityId
    : null;
}

/**
 * Whether this very event was already applied (the claim ledger, or the audit
 * log of an older cloud). A retry of an applied event is acknowledged, not
 * re-decided: the work was authorized when it was applied, so a later role change
 * must not dead-letter its retry.
 */
export async function isDesktopSyncEventApplied(
  organizationId: string,
  event: SyncEvent,
): Promise<boolean> {
  const [claim] = await orgDb(organizationId).transaction((o) =>
    o
      .select({ appliedAt: syncAppliedEvent.appliedAt })
      .from(syncAppliedEvent)
      .where(
        and(
          eq(syncAppliedEvent.organizationId, organizationId),
          eq(syncAppliedEvent.eventId, event.eventId),
        ),
      )
      .limit(1),
  );
  if (claim?.appliedAt) return true;
  return (await findAppliedDesktopSyncEvent(organizationId, event)) !== null;
}

export async function findAppliedDesktopSyncEvent(
  organizationId: string,
  event: SyncEvent,
  executor?: AuditLogReader,
) {
  const rows = await withOrgReader(organizationId, executor, (reader) =>
    reader
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
      .limit(100),
  );

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
    input.o,
  );
}

export async function writeDesktopSyncAudit(
  input: ApplyDesktopSyncEventInput,
  actorUserId: string,
  details: Record<string, unknown> = {},
) {
  const claimedActorUserId = getClaimedSyncActorUserId(input.event.actorUserId);
  await writeOrganizationAuditEvent(
    {
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
    },
    // The event's own transaction: the audit row commits with the change.
    input.o,
  );
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
  // Before the event's transaction: a short one that names the laboratory.
  const [record] = await orgDb(organizationId).transaction((o) =>
    o
      .select({ id: member.id })
      .from(member)
      .where(
        and(
          eq(member.userId, userId),
          eq(member.organizationId, organizationId),
        ),
      )
      .limit(1),
  );

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
