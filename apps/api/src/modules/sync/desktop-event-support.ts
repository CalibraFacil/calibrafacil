import { type SyncCommand } from "@calibra-facil/contracts";
import type { OrgDb } from "@calibra-facil/db/for-org";
import { type MemberData } from "../../middleware/permission";
import {
  type AppliedEventResult,
  type RefusedEventResult,
} from "./event-transaction";
import { asRecord } from "./helpers";

/**
 * What one push request remembers across its events. A desktop queues several
 * edits of one job (autosaves, then the submit), all made against the same
 * pulled base; the first one's write moves the job's `updatedAt`, which must
 * not make the next one look like somebody else's change.
 */
export type PushBatchState = {
  /** Cloud job id -> the `updatedAt` (epoch ms) this request's last event left it at. */
  jobUpdatedAtMs: Map<number, number>;
};

export type ApplyDesktopSyncEventInput = {
  event: SyncCommand;
  memberData: MemberData;
  /**
   * The event's own transaction, bound to the laboratory of the pushing device
   * (`applyDesktopEventAtomically`): every read and write of the apply goes
   * through it, so the change, its audit rows and the "applied" record commit
   * or roll back together.
   */
  o: OrgDb;
  sessionUserId: string;
  deviceId: string;
  clientBatchId: string;
  /** `SYNC_MIN_DESKTOP_VERSION`: when set, the legacy calibration-record exemption is over. */
  minimumDesktopVersion: string | undefined;
  batch: PushBatchState;
  /** What `prepareDesktopEventSideEffects` did before the event's transaction. */
  prepared: PreparedDesktopEventSideEffects;
};

/**
 * Side effects of an event that need a database connection of their own
 * (better-auth creates an organization through its own adapter) cannot run in
 * the event's transaction: with a small pool the transaction holds the only
 * connection and the side effect waits for it forever, and what it writes would
 * survive the rollback of the event. They run first, outside the transaction,
 * idempotently on the event id, and the transaction only references the result.
 */
export type PreparedDesktopEventSideEffects = {
  /** `create_local_customer`: the client organization created for this event. */
  clientOrganizationId?: string;
  /** The event cannot be applied (permanent): reported without opening a transaction. */
  refusal?: { code: string; reason: string };
};

export type ApplyDesktopSyncEventResult =
  | AppliedEventResult
  | RefusedEventResult;

/**
 * The id a rejection names for an event that cannot be read. An event with no
 * usable `eventId` is named by its position in the batch (zero-based), so the
 * refusal is traceable instead of anonymous.
 */
export function rejectedEventId(rawEvent: unknown, index: number): string {
  const record = asRecord(rawEvent);
  return typeof record.eventId === "string" && record.eventId.length > 0
    ? record.eventId
    : `batch-index:${index}`;
}

/** Records the `updatedAt` a job execution left the cloud job at, for the events after it. */
export function noteAppliedJobVersion(
  batch: PushBatchState,
  command: SyncCommand,
  remoteEntity: unknown,
) {
  if (
    command.operation !== "save_local_execution" &&
    command.operation !== "submit_local_execution"
  ) {
    return;
  }
  const entity = asRecord(remoteEntity);
  const id = entity.id;
  const updatedAt = entity.updatedAt;
  if (typeof id !== "number" || typeof updatedAt !== "string") return;
  const ms = Date.parse(updatedAt);
  if (!Number.isNaN(ms)) batch.jobUpdatedAtMs.set(id, ms);
}

// ============================================================================
// Optimistic-concurrency guard for the blind desktop applies (REL-01 slice 2)
// ============================================================================
// The desktop emits `baseUpdatedAt` — the cloud row's `updatedAt` captured at
// PULL time (slice 1). If the server row's current `updatedAt` is STRICTLY after
// that base, the cloud advanced since the desktop last pulled, so the desktop
// edit was made against a stale base and a blind UPDATE would silently lose the
// cloud change (last-write-wins). Equal timestamps = unchanged since pull = safe
// to apply (no false conflict). A null / absent / unparseable base means "cannot
// check" → apply exactly as today (backward compatible with older desktop builds
// that never emit it, and with rows that were never pulled).
type StaleDesktopBase =
  | { diverged: false }
  | { diverged: true; serverUpdatedAtIso: string; baseUpdatedAt: string };

export function detectStaleDesktopBase(params: {
  baseUpdatedAt: string | null | undefined;
  serverUpdatedAt: Date | string | null | undefined;
}): StaleDesktopBase {
  const base = params.baseUpdatedAt;
  if (base === null || base === undefined) return { diverged: false };
  const baseMs = Date.parse(base);
  if (Number.isNaN(baseMs)) return { diverged: false };

  const server = params.serverUpdatedAt;
  if (server === null || server === undefined) return { diverged: false };
  const serverDate = server instanceof Date ? server : new Date(server);
  const serverMs = serverDate.getTime();
  if (Number.isNaN(serverMs)) return { diverged: false };

  // Strictly after: equal means the row is still at the pulled version.
  if (serverMs > baseMs) {
    return {
      diverged: true,
      serverUpdatedAtIso: serverDate.toISOString(),
      baseUpdatedAt: base,
    };
  }
  return { diverged: false };
}

// Build the conflict result the push handler turns into a `sync_conflicts` row
// (`conflictType` + `remotePayload`) — the SAME shape the job-execution guard
// already uses. `concurrent_update` is the version-based conflict type the
// desktop conflicts UI already labels ("Atualização concorrente"). The remote
// payload carries enough to resolve: the entity, its cloud id, the server's
// current `updatedAt`, and the base the desktop edited against.
export function buildStaleDesktopBaseConflict(params: {
  entity: string;
  id: number;
  serverUpdatedAtIso: string;
  baseUpdatedAt: string;
  // REL-01 slice 3 (REQ-REL-RES-001): the CURRENT cloud row's diff-relevant
  // fields, so the desktop conflicts UI renders real cloud values instead of
  // "—" for every column. Read from the row already fetched under the caller's
  // tenant WHERE clause; the fixed keys below always win over these.
  remoteFields?: Record<string, unknown>;
}): ApplyDesktopSyncEventResult {
  return {
    ok: false,
    code: "STALE_BASE_VERSION",
    reason: `Cloud ${params.entity} advanced since the desktop pulled (base ${params.baseUpdatedAt}, server ${params.serverUpdatedAtIso}).`,
    conflict: {
      conflictType: "concurrent_update",
      remotePayload: {
        ...params.remoteFields,
        entity: params.entity,
        id: params.id,
        updatedAt: params.serverUpdatedAtIso,
        baseUpdatedAt: params.baseUpdatedAt,
      },
    },
  };
}

/**
 * When an offline calibration was performed. The desktop stamps the submit
 * event with the local time it happened; using the sync time instead would put
 * the day the laptop got connectivity on the certificate, the asset's next-due
 * date and the standards-used-at links. A device clock is not trusted to lie
 * about the future: the value is clamped to `now`, and an absent/unparseable
 * `occurredAt` falls back to `now`.
 * Exported for spec coverage; not part of the route surface.
 */
export function resolveDesktopPerformedAt(
  occurredAt: string | null | undefined,
  now: Date = new Date(),
) {
  if (!occurredAt) return now;
  const parsed = new Date(occurredAt);
  if (Number.isNaN(parsed.getTime())) return now;
  return parsed.getTime() > now.getTime() ? now : parsed;
}
