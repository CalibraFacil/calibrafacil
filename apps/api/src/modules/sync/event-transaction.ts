import { db, runInTransactionScope } from "@calibra-facil/db";
import {
  setTransactionOrganization,
  type OrgDb,
} from "@calibra-facil/db/for-org";
import { orgDb } from "../../lib/org-db";
import {
  lockSyncAggregate,
  readSyncAggregateVersion,
} from "./aggregate-version";
import {
  claimDesktopSyncEvent,
  completeDesktopSyncClaim,
  type LegacyAppliedEvent,
} from "./applied-events";

export type AppliedEventResult = {
  ok: true;
  remoteEntityId?: number | string;
  remoteEntity?: unknown;
};

export type RefusedEventResult = {
  ok: false;
  code: string;
  reason: string;
  /** Answered as a reviewable conflict instead of a refusal. */
  conflict?: {
    conflictType: string;
    remotePayload?: unknown;
  };
};

export type DesktopEventOutcome =
  /** An earlier push applied it: its recorded result, nothing applied now. */
  | {
      state: "already_applied";
      remoteEntityId?: number | string;
      remoteEntity?: unknown;
      aggregateVersion?: number;
    }
  /** A concurrent request holds the claim and may still fail: retry later. */
  | { state: "in_progress" }
  | { state: "applied"; result: AppliedEventResult; aggregateVersion: number }
  /** Refused or in conflict: nothing was written. */
  | { state: "refused"; result: RefusedEventResult }
  /** The transaction failed (a write, the audit row, the commit): nothing was written. */
  | { state: "failed"; message: string };

/**
 * A pushed event whose expected aggregate version is not the current one: somebody else's
 * write (another device, or an earlier edit of this one that was replayed late) moved the
 * aggregate since the desktop's copy. Never applied over: answered as a reviewable
 * conflict. The remote payload names the current version, which is what the desktop adopts
 * when its user keeps the local change.
 */
export function staleExpectedVersionRefusal(input: {
  entityType: string;
  entityId: string;
  expectedVersion: number;
  currentVersion: number;
}): RefusedEventResult {
  return {
    ok: false,
    code: "STALE_EXPECTED_VERSION",
    reason: `The ${input.entityType} is at version ${input.currentVersion} in the cloud; this change expected version ${input.expectedVersion}.`,
    conflict: {
      conflictType: "stale_version",
      remotePayload: {
        entity: input.entityType,
        id: input.entityId,
        aggregateVersion: input.currentVersion,
        expectedVersion: input.expectedVersion,
      },
    },
  };
}

class EventRefusedError extends Error {
  constructor() {
    super("The desktop sync event was refused; rolling its transaction back.");
    this.name = "EventRefusedError";
  }
}

/**
 * Apply one pushed event in ONE database transaction: the idempotency claim,
 * the change, every audit row the change writes and the "applied" record
 * commit together or not at all.
 *
 * Everything `apply` writes through `db` (or any helper that does) is inside
 * the transaction; helpers that open their own transaction nest as savepoints.
 * An event that is refused, conflicts or throws rolls back whole, so a state
 * change can never land without its audit row, and a refused event leaves no
 * claim behind: the corrected (or re-based) event can be pushed again. The
 * claim row is inserted in the same transaction, so a concurrent push of the
 * same event waits on the unique index for this one to commit or roll back,
 * then reads the outcome.
 *
 * The failure of one event is the outcome of that event: the caller reports it
 * and goes on with the next.
 */
export async function applyDesktopEventAtomically(params: {
  organizationId: string;
  event: { eventId: string; entityType: string; entityId: string };
  /** Applied before `sync_applied_event` existed: only the audit log knows. */
  findLegacyApplied: (o: OrgDb) => Promise<LegacyAppliedEvent | null>;
  /**
   * The version of the aggregate the desktop expects (`SyncEvent.expectedVersion`).
   * Absent or null: no expectation, applied with the `baseUpdatedAt` check alone.
   */
  expectedVersion?: number | null;
  /** Runs on `o`, the handle of the event's transaction (bound to the laboratory). */
  apply: (o: OrgDb) => Promise<AppliedEventResult | RefusedEventResult>;
}): Promise<DesktopEventOutcome> {
  const captured: {
    refusal: RefusedEventResult | null;
    currentVersion: number | null;
  } = { refusal: null, currentVersion: null };

  try {
    return await runInTransactionScope(
      async (): Promise<DesktopEventOutcome> => {
        // Row-level security: the event's transaction names the laboratory of
        // the pushing device before its first statement, as
        // `orgDb(lab).transaction` does. `db` is this very transaction in the
        // scope, so the claim, the change, every audit row and every helper
        // that reaches for `db` (or opens a savepoint) run as that laboratory
        // and see only its rows. `o` is the same transaction behind the
        // handle that also adds the organization predicate to each statement.
        await setTransactionOrganization(db, params.organizationId);
        const o = orgDb(params.organizationId);
        const claim = await claimDesktopSyncEvent(
          o,
          params.organizationId,
          params.event,
          () => params.findLegacyApplied(o),
        );
        if (claim.state === "applied") {
          return {
            state: "already_applied",
            remoteEntityId: claim.remoteEntityId,
            remoteEntity: claim.remoteEntity,
            aggregateVersion: claim.aggregateVersion,
          };
        }
        if (claim.state === "in_progress") return { state: "in_progress" };

        // One writer at a time per aggregate until this transaction ends: the version is
        // read, checked and the next one recorded without another push in between.
        await lockSyncAggregate(o, params.organizationId, params.event);
        const currentVersion = await readSyncAggregateVersion(
          o,
          params.organizationId,
          params.event,
        );
        captured.currentVersion = currentVersion;
        if (
          typeof params.expectedVersion === "number" &&
          params.expectedVersion !== currentVersion
        ) {
          captured.refusal = staleExpectedVersionRefusal({
            entityType: params.event.entityType,
            entityId: params.event.entityId,
            expectedVersion: params.expectedVersion,
            currentVersion,
          });
          throw new EventRefusedError();
        }

        const result = await params.apply(o);
        if (!result.ok) {
          captured.refusal = result;
          throw new EventRefusedError();
        }
        const aggregateVersion = currentVersion + 1;
        await completeDesktopSyncClaim(
          o,
          params.organizationId,
          claim.claimId,
          result,
          aggregateVersion,
        );
        return { state: "applied", result, aggregateVersion };
      },
    );
  } catch (error) {
    if (error instanceof EventRefusedError && captured.refusal) {
      return {
        state: "refused",
        result: withAggregateVersion(captured.refusal, captured.currentVersion),
      };
    }
    return {
      state: "failed",
      message:
        error instanceof Error ? error.message : "Desktop sync event failed.",
    };
  }
}

/**
 * A conflict names the aggregate's current version (`remotePayload.aggregateVersion`), so
 * that a desktop whose user keeps the local change can push it again against that version
 * instead of being refused for the very change they decided to override.
 */
function withAggregateVersion(
  refusal: RefusedEventResult,
  currentVersion: number | null,
): RefusedEventResult {
  if (!refusal.conflict || currentVersion === null) return refusal;
  const remote = refusal.conflict.remotePayload;
  if (remote !== null && typeof remote === "object" && !Array.isArray(remote)) {
    return {
      ...refusal,
      conflict: {
        ...refusal.conflict,
        remotePayload: { aggregateVersion: currentVersion, ...remote },
      },
    };
  }
  if (remote === undefined) {
    return {
      ...refusal,
      conflict: {
        ...refusal.conflict,
        remotePayload: { aggregateVersion: currentVersion },
      },
    };
  }
  return refusal;
}
