import { db, runInTransactionScope } from "@calibra-facil/db";
import {
  setTransactionOrganization,
  type OrgDb,
} from "@calibra-facil/db/for-org";
import { orgDb } from "../../lib/org-db";
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
    }
  /** A concurrent request holds the claim and may still fail: retry later. */
  | { state: "in_progress" }
  | { state: "applied"; result: AppliedEventResult }
  /** Refused or in conflict: nothing was written. */
  | { state: "refused"; result: RefusedEventResult }
  /** The transaction failed (a write, the audit row, the commit): nothing was written. */
  | { state: "failed"; message: string };

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
  /** Runs on `o`, the handle of the event's transaction (bound to the laboratory). */
  apply: (o: OrgDb) => Promise<AppliedEventResult | RefusedEventResult>;
}): Promise<DesktopEventOutcome> {
  const captured: { refusal: RefusedEventResult | null } = { refusal: null };

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
          };
        }
        if (claim.state === "in_progress") return { state: "in_progress" };

        const result = await params.apply(o);
        if (!result.ok) {
          captured.refusal = result;
          throw new EventRefusedError();
        }
        await completeDesktopSyncClaim(
          o,
          params.organizationId,
          claim.claimId,
          result,
        );
        return { state: "applied", result };
      },
    );
  } catch (error) {
    if (error instanceof EventRefusedError && captured.refusal) {
      return { state: "refused", result: captured.refusal };
    }
    return {
      state: "failed",
      message:
        error instanceof Error ? error.message : "Desktop sync event failed.",
    };
  }
}
