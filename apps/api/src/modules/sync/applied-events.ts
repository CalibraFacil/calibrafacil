import type { OrgDb } from "@calibra-facil/db/for-org";
import { syncAppliedEvent } from "@calibra-facil/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { asRecord } from "./helpers";

export type LegacyAppliedEvent = {
  remoteEntityId?: number | string;
  remoteEntity?: unknown;
};

// How long a claim without `applied_at` blocks other pushes of the same op. A
// claim only outlives its request if the process died mid-apply; after the
// lease the op is taken over instead of stuck forever.
export const SYNC_EVENT_CLAIM_LEASE_SECONDS = 300;

export type DesktopSyncClaim =
  | { state: "claimed"; claimId: number }
  | {
      state: "applied";
      remoteEntityId?: number | string;
      remoteEntity?: unknown;
      /** The aggregate version this event produced; absent on rows from before versions. */
      aggregateVersion?: number;
    }
  | { state: "in_progress" };

/**
 * Decide whether this push may apply the op, atomically.
 *
 * The audit-log lookup alone is read-then-write: two concurrent pushes of one
 * op id both miss it and both apply. The insert into `sync_applied_event`
 * (unique per organization and op id) is the arbiter: exactly one request
 * wins the claim; the others see it as applied or in progress.
 *
 * The caller (`applyDesktopEventAtomically`) runs this inside the event's own
 * transaction, together with the change, its audit rows and
 * `completeDesktopSyncClaim`. So the claim is never visible half-done: a push
 * that loses the race blocks on the unique index until the winner commits (it
 * then reads the recorded result) or rolls back (it then claims the op itself),
 * and an op that does not apply leaves no claim behind. The lease below only
 * matters for rows written before the claim moved into the transaction: a
 * process that died mid-apply could leave a claim without `applied_at`, and
 * after the lease that op is taken over instead of stuck forever.
 */
export async function claimDesktopSyncEvent(
  o: OrgDb,
  organizationId: string,
  event: { eventId: string; entityType: string; entityId: string },
  findLegacyApplied: () => Promise<LegacyAppliedEvent | null>,
): Promise<DesktopSyncClaim> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const [existing] = await o
      .select({
        id: syncAppliedEvent.id,
        appliedAt: syncAppliedEvent.appliedAt,
        result: syncAppliedEvent.result,
        aggregateVersion: syncAppliedEvent.aggregateVersion,
      })
      .from(syncAppliedEvent)
      .where(
        and(
          eq(syncAppliedEvent.organizationId, organizationId),
          eq(syncAppliedEvent.eventId, event.eventId),
        ),
      )
      .limit(1);

    if (existing?.appliedAt) {
      const result = asRecord(existing.result);
      const remoteEntityId = result.remoteEntityId;
      return {
        state: "applied",
        remoteEntityId:
          typeof remoteEntityId === "number" ||
          typeof remoteEntityId === "string"
            ? remoteEntityId
            : undefined,
        remoteEntity: result.remoteEntity,
        aggregateVersion: existing.aggregateVersion ?? undefined,
      };
    }

    if (!existing) {
      // Applied before sync_applied_event existed: only the audit log knows.
      const legacy = await findLegacyApplied();
      if (legacy) return { state: "applied", ...legacy };

      const [claimed] = await o
        .insert(syncAppliedEvent)
        .values({
          organizationId,
          eventId: event.eventId,
          entityType: event.entityType,
          entityId: event.entityId,
        })
        .onConflictDoNothing()
        .returning();
      if (claimed) return { state: "claimed", claimId: claimed.id };
      // Lost the race to a concurrent push: look at what it recorded.
      continue;
    }

    // Claimed but not applied: in flight, or abandoned by a dead process.
    const [takenOver] = await o
      .update(syncAppliedEvent)
      .set({ claimedAt: sql`now()` })
      .where(
        and(
          eq(syncAppliedEvent.organizationId, organizationId),
          eq(syncAppliedEvent.id, existing.id),
          isNull(syncAppliedEvent.appliedAt),
          sql`${syncAppliedEvent.claimedAt} < now() - make_interval(secs => ${SYNC_EVENT_CLAIM_LEASE_SECONDS})`,
        ),
      )
      .returning();
    if (takenOver) {
      // The dead process may have got as far as writing its audit row (the
      // last thing an op does) before it could mark the claim applied. Taking
      // over blindly would apply the op a second time.
      const legacy = await findLegacyApplied();
      if (legacy) {
        await completeDesktopSyncClaim(o, organizationId, takenOver.id, legacy);
        return { state: "applied", ...legacy };
      }
      return { state: "claimed", claimId: takenOver.id };
    }

    return { state: "in_progress" };
  }

  return { state: "in_progress" };
}

export async function completeDesktopSyncClaim(
  o: OrgDb,
  organizationId: string,
  claimId: number,
  result: { remoteEntityId?: number | string; remoteEntity?: unknown },
  aggregateVersion?: number,
) {
  await o
    .update(syncAppliedEvent)
    .set({
      appliedAt: sql`now()`,
      ...(aggregateVersion === undefined ? {} : { aggregateVersion }),
      result: {
        remoteEntityId: result.remoteEntityId,
        remoteEntity: result.remoteEntity,
      },
    })
    .where(
      and(
        eq(syncAppliedEvent.organizationId, organizationId),
        eq(syncAppliedEvent.id, claimId),
      ),
    );
}
