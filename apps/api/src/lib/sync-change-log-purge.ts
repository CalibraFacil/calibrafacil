/**
 * Retention of the desktop change log (`sync_change_log`, docs/architecture/sync-change-seq.md).
 *
 * Entries older than `SYNC_CHANGE_LOG_RETENTION_DAYS` (default 90) are deleted, and
 * the newest `(xid, seq)` removed from each laboratory is recorded in
 * `sync_change_log_purge`, in the same statement. A protocol 3 pull whose cursor sorts
 * below that horizon may have missed entries: the API answers it with the typed
 * "bootstrap again" response instead of serving a log with a hole in it.
 *
 * Cross-tenant by design (a platform maintenance job, like records-purge), so it
 * appears in test/integration/tenant-sql-allowlist.ts.
 */
import { sql } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import { readSyncConfig } from "@calibra-facil/config";
import { getExecuteRows } from "./db";

export type SyncChangeLogPurgeResult = {
  /** Entries deleted. */
  purged: number;
  /** Laboratories whose purge horizon moved. */
  organizations: number;
};

export async function purgeSyncChangeLog(
  options: { retentionDays?: number } = {},
): Promise<SyncChangeLogPurgeResult> {
  const retentionDays =
    options.retentionDays ?? readSyncConfig().changeLogRetentionDays;
  if (!Number.isInteger(retentionDays) || retentionDays < 1) {
    throw new Error(`invalid change log retention: ${retentionDays} days`);
  }

  // `changed_at` is a `timestamp` written in the session time zone (`now()`), so it is
  // compared with `localtimestamp`, which is in the same zone.
  const result = await db.execute(sql`
    WITH purged AS (
      DELETE FROM sync_change_log
      WHERE changed_at < localtimestamp - make_interval(days => ${retentionDays})
      RETURNING organization_id, xid, seq
    ),
    horizon AS (
      SELECT DISTINCT ON (organization_id) organization_id, xid, seq
      FROM purged
      ORDER BY organization_id, xid DESC, seq DESC
    ),
    recorded AS (
      INSERT INTO sync_change_log_purge
        (organization_id, purged_through_xid, purged_through_seq, purged_at)
      SELECT organization_id, xid, seq, now() FROM horizon
      ON CONFLICT (organization_id) DO UPDATE SET
        purged_through_xid = EXCLUDED.purged_through_xid,
        purged_through_seq = EXCLUDED.purged_through_seq,
        purged_at = EXCLUDED.purged_at
      WHERE (EXCLUDED.purged_through_xid, EXCLUDED.purged_through_seq)
        > (sync_change_log_purge.purged_through_xid, sync_change_log_purge.purged_through_seq)
      RETURNING 1
    )
    SELECT
      (SELECT count(*) FROM purged)::int AS purged,
      (SELECT count(*) FROM horizon)::int AS organizations
  `);
  const [row] = getExecuteRows<{
    purged: number | string;
    organizations: number | string;
  }>(result);
  return {
    purged: Number(row?.purged ?? 0),
    organizations: Number(row?.organizations ?? 0),
  };
}
