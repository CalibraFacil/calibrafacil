import type { OrgDb } from "@calibra-facil/db/for-org";
import { syncAppliedEvent } from "@calibra-facil/db/schema";
import { and, eq, sql } from "drizzle-orm";

/**
 * The version of a desktop-synced aggregate (roadmap 2 E1).
 *
 * An aggregate is what the desktop names by `entityType` + `entityId`. Its version is a
 * plain integer counted by the cloud: every desktop event the cloud applies to it produces
 * the next one (1, 2, 3...), recorded on that event's `sync_applied_event` row. A replay of
 * an applied event adds no row, so it never moves the version. Online edits do not move it
 * (they are covered by the `baseUpdatedAt` check, which compares the row's own timestamp);
 * this version orders the desktop's own writes: a second device, or an older autosave
 * replayed after a newer one, holds a version that is no longer current.
 *
 * Both functions run inside the event's transaction (`applyDesktopEventAtomically`).
 */

/**
 * Serialises the writers of one aggregate until the transaction ends, so two pushes of
 * the same aggregate read the version, apply and record the next one one after the other.
 * The key pair is (32-bit hash of the aggregate, a constant of its own), apart from the
 * numbering locks; two aggregates that collide only wait for each other.
 */
export async function lockSyncAggregate(
  o: OrgDb,
  organizationId: string,
  event: { entityType: string; entityId: string },
) {
  await o.advisoryXactLock(
    hash32(`${organizationId}\u0000${event.entityType}\u0000${event.entityId}`),
    SYNC_AGGREGATE_LOCK_KEY,
  );
}

const SYNC_AGGREGATE_LOCK_KEY = 7042;

/** FNV-1a, as a signed 32-bit integer (the range of an advisory lock key). */
function hash32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
}

/** The current version of the aggregate: 0 when no desktop event was applied to it. */
export async function readSyncAggregateVersion(
  o: OrgDb,
  organizationId: string,
  event: { entityType: string; entityId: string },
): Promise<number> {
  const [row] = await o
    .select({
      version: sql<number | null>`max(${syncAppliedEvent.aggregateVersion})`,
    })
    .from(syncAppliedEvent)
    .where(
      and(
        eq(syncAppliedEvent.organizationId, organizationId),
        eq(syncAppliedEvent.entityType, event.entityType),
        eq(syncAppliedEvent.entityId, event.entityId),
      ),
    );

  return Number(row?.version ?? 0);
}
