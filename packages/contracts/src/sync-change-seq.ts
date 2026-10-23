import { z } from "zod";
import { syncBootstrapResponseSchema } from "./sync";

/**
 * The commit-ordered pull (protocol 3). docs/architecture/sync-change-seq.md
 * explains why the cursor is a change-log position and not a timestamp, and why
 * the server only ever hands out the part of the log that can no longer grow
 * behind the cursor.
 *
 * A position is `(xid, seq)`: the id of the transaction that wrote the log entry
 * (`xid8`, 64 bits, never wraps) and the entry's own sequence number (a tiebreak
 * inside one transaction). The cursor is the opaque string `v3|<xid>|<seq>`; a
 * desktop only stores it and sends it back.
 *
 * The cursor `v3|X|0` means "every entry of a transaction below X is covered":
 * sequence numbers start at 1, so every entry of transaction X itself sorts after
 * it. The bootstrap hands out exactly that, with X the oldest transaction still
 * in flight when the snapshot was cut.
 */
export const SYNC_CHANGE_SEQ_PROTOCOL_VERSION = 3;

/** Query parameter by which a desktop states the protocol it pulls with. */
export const SYNC_PULL_PROTOCOL_PARAM = "protocolVersion";

const CURSOR_PATTERN = /^v3\|(\d{1,20})\|(\d{1,19})$/;
const MAX_XID = 18_446_744_073_709_551_615n; // 2^64 - 1 (xid8)
const MAX_SEQ = 9_223_372_036_854_775_807n; // 2^63 - 1 (bigserial)

export type SyncChangePosition = { xid: bigint; seq: bigint };

export function formatSyncChangeCursor(position: SyncChangePosition): string {
  return `v3|${position.xid}|${position.seq}`;
}

export type ParsedSyncChangeCursor =
  | { kind: "position"; position: SyncChangePosition }
  /** Nothing stored: a desktop that never completed a bootstrap. */
  | { kind: "absent" }
  /** A cursor of another protocol (the `updatedAt` cursors of protocol 1 and 2). */
  | { kind: "foreign" };

export function parseSyncChangeCursor(
  cursor: string | null | undefined,
): ParsedSyncChangeCursor {
  if (cursor === null || cursor === undefined || cursor === "") {
    return { kind: "absent" };
  }
  const match = CURSOR_PATTERN.exec(cursor);
  if (!match) return { kind: "foreign" };
  const [, rawXid, rawSeq] = match;
  if (rawXid === undefined || rawSeq === undefined) return { kind: "foreign" };
  const xid = BigInt(rawXid);
  const seq = BigInt(rawSeq);
  if (xid > MAX_XID || seq > MAX_SEQ) return { kind: "foreign" };
  return { kind: "position", position: { xid, seq } };
}

export function compareSyncChangePositions(
  left: SyncChangePosition,
  right: SyncChangePosition,
): -1 | 0 | 1 {
  if (left.xid !== right.xid) return left.xid < right.xid ? -1 : 1;
  if (left.seq !== right.seq) return left.seq < right.seq ? -1 : 1;
  return 0;
}

/**
 * The cursor that makes the next pull return the entry at `position` again: the
 * largest position strictly below it. A desktop keeps it for a row it skipped
 * because of queued local changes, to rewind to once they settle.
 */
export function syncChangeCursorBefore(position: SyncChangePosition): string {
  return formatSyncChangeCursor({
    xid: position.xid,
    seq: position.seq > 0n ? position.seq - 1n : 0n,
  });
}

// ---------------------------------------------------------------------------
// "Pull again from the start": the cursor cannot be served.
// ---------------------------------------------------------------------------

export const SYNC_RESYNC_REQUIRED_CODE = "SYNC_RESYNC_REQUIRED";

export const syncResyncReasonSchema = z.enum([
  /** The desktop has no cursor (its bootstrap never completed). */
  "no_cursor",
  /** The cursor is of the `updatedAt` protocols: a desktop that just upgraded. */
  "cursor_format",
  /** The entries after the cursor were purged (retention): the cursor is too old. */
  "cursor_purged",
]);

/**
 * Answer (HTTP 409) to a protocol 3 pull whose cursor cannot be served. The desktop
 * drops its cursor and bootstraps again; its queued local changes are untouched
 * (a bootstrap never overwrites a row with queued changes).
 */
export const syncResyncRequiredResponseSchema = z.object({
  code: z.literal(SYNC_RESYNC_REQUIRED_CODE),
  reason: syncResyncReasonSchema,
  message: z.string(),
});

export type SyncResyncRequiredResponse = z.infer<
  typeof syncResyncRequiredResponseSchema
>;

export function buildSyncResyncRequiredResponse(
  reason: SyncResyncRequiredResponse["reason"],
): SyncResyncRequiredResponse {
  return {
    code: SYNC_RESYNC_REQUIRED_CODE,
    reason,
    message:
      reason === "cursor_purged"
        ? "The desktop has been offline longer than the change log is kept: bootstrap again."
        : "The desktop has no usable change cursor: bootstrap again.",
  };
}

// ---------------------------------------------------------------------------
// The paged bootstrap
// ---------------------------------------------------------------------------

/** Rows of one bootstrap page when the desktop does not ask for a size. */
export const SYNC_BOOTSTRAP_DEFAULT_PAGE_SIZE = 500;
export const SYNC_BOOTSTRAP_MAX_PAGE_SIZE = 1000;

export const syncBootstrapPageRequestSchema = z.object({
  /**
   * What makes the cloud answer with pages: a desktop of protocol 3 or later says so,
   * on the same `POST /api/sync/bootstrap` the older ones call without a body. A cloud
   * that predates protocol 3 ignores it and answers the whole bootstrap at once, which a
   * desktop of protocol 3 also reads (`syncBootstrapPageResponseSchema` is that answer
   * plus `page`).
   */
  protocolVersion: z.number().int().positive().optional(),
  /** The `nextToken` of the previous page; absent for the first page. */
  pageToken: z.string().min(1).nullable().optional(),
  limit: z
    .number()
    .int()
    .positive()
    .max(SYNC_BOOTSTRAP_MAX_PAGE_SIZE)
    .optional(),
});

export type SyncBootstrapPageRequest = z.infer<
  typeof syncBootstrapPageRequestSchema
>;

/**
 * One page of the bootstrap: the session header (user, organization, units,
 * permissions, flags) and a slice of the entity arrays, `rowCount` rows in all.
 * `syncCursor` is the position the pull starts from once the LAST page is applied;
 * it is the same on every page of one bootstrap (it travels inside the token).
 * `nextToken` is null on the last page. A desktop keeps the token of the last page
 * it applied: after an interruption it asks for the page after it, never the first
 * again.
 */
export const syncBootstrapPageResponseSchema =
  syncBootstrapResponseSchema.extend({
    syncCursor: z.string(),
    page: z.object({
      nextToken: z.string().nullable(),
      rowCount: z.number().int().nonnegative(),
    }),
  });

export type SyncBootstrapPageResponse = z.infer<
  typeof syncBootstrapPageResponseSchema
>;
