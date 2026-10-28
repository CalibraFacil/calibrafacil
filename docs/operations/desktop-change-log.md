# Desktop change log (sync protocol 3)

Runbook moved out of [`DEPLOYMENT.md`](../../DEPLOYMENT.md#runbooks) (roadmap 2 G5).

Protocol 3 replaces the `updatedAt` pull cursor and the one-shot bootstrap of protocols 1 and 2
(design and correctness argument: `docs/architecture/sync-change-seq.md`).

- **Migration `0122_sync_change_log`** creates `sync_change_log` (one row per change of a table the
  desktop mirrors, written by triggers in the writer's own transaction) and
  `sync_change_log_purge`. It backfills nothing: a desktop on protocol 3 starts from a bootstrap, whose
  cursor is the current position. Apply it before deploying the API that serves protocol 3 (a
  desktop that asks for protocol 3 before the table exists gets a 500 on pull).
- **What a desktop of protocol 3 does.** It states `protocolVersion: 3` on the bootstrap request and
  as `?protocolVersion=3` on the pull. The cloud then bootstraps in pages (`page.nextToken`; the
  desktop resumes an interrupted bootstrap from the last page it applied) and pulls the change log by
  position. A desktop that upgrades from protocol 2 holds an `updatedAt` cursor the log cannot serve:
  the cloud answers its first protocol 3 pull `409 { "code": "SYNC_RESYNC_REQUIRED" }` and the
  desktop bootstraps again (its queued local changes are untouched: a bootstrap never overwrites a
  row with queued changes).
- **Desktops of protocol 1 and 2 keep working.** A bootstrap or pull that does not state protocol 3
  gets the old behaviour, unchanged, with a `Deprecation: true` header. A desktop of protocol 3 against
  a cloud that predates it gets the old answers too (the cloud ignores the field on the bootstrap and
  the pull) and reads them as before. Its push states protocol 3, which the older cloud refuses with
  `400 SYNC_PROTOCOL_UNSUPPORTED { supportedProtocolVersion }`; the push format did not change, so the
  desktop sends the same push again, once, with the protocol the cloud names, and remembers it for
  that cloud (queued events are neither failed nor delayed). The order of the rolling deploy
  therefore does not matter. The legacy path is deleted once
  `SYNC_MIN_DESKTOP_VERSION` is set to the first build that speaks protocol 3 (see _Minimum desktop
  version_ above: those desktops are refused at push, so they only pull, and a pull without changes
  to push is harmless): remove `loadCloudSyncEventsSince`, the legacy branch of `GET /api/sync/pull`
  and of `POST /api/sync/bootstrap`, and `modules/sync/pull-cursor.ts`.
- **Retention.** The `sync-change-log-purge` cron (daily, 04:15 UTC) deletes entries older than
  `SYNC_CHANGE_LOG_RETENTION_DAYS` (default `90`, minimum `7`; an unusable value means the default)
  and records, per laboratory, the newest position it removed. A desktop that was offline longer than
  that finds its cursor below the recorded position and is told `SYNC_RESYNC_REQUIRED` with reason
  `cursor_purged`: it bootstraps again, which also removes the mirror rows the cloud deleted in the
  meantime. Nothing to configure on the desktop.
- **Latency, never loss.** The pull serves only entries of transactions older than the oldest
  transaction still in flight (`pg_snapshot_xmin`), which is what makes it impossible to skip a row. A
  write transaction that stays open for a long time anywhere in the database cluster (another
  database included) holds the horizon back: desktops keep pulling, they just see nothing new
  until it ends. Keep write transactions short, and set `idle_in_transaction_session_timeout`
  on the database so that a stuck client cannot hold the horizon forever.
