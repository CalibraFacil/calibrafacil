# The desktop change log (sync protocol 3)

Roadmap P2-4b. Replaces the `updatedAt` pull cursor and the unpaginated bootstrap of sync protocols 1
and 2. Code: `apps/api/src/modules/sync/{change-log,bootstrap-pages,entity-sources}.ts`,
`packages/db/drizzle/0122_sync_change_log.sql`, `packages/contracts/src/sync-change-seq.ts`; on the
desktop `packages/local-db/src/{sync,skipped-rows}.ts` and `apps/local-server/src/sync.ts`.

## What was wrong

1. **A row could be missed.** The pull cursor was a row's `updated_at`: the time it was _written_, not
   the time its transaction _committed_. A transaction that stamped `T1` and committed after a reader
   had returned a row stamped `T2 > T1` was invisible to every later pull. (`pull-cursor.ts` documented
   the hazard and could not fix it: replaying an overlap window would have clobbered local edits.)
2. **Deletes were not reliable.** Only soft-deleted assets and standards reached the desktop. A hard
   delete left nothing to pull, and a row moved out of the desktop's unit scope simply stopped appearing.
3. **The bootstrap was one response**: every row of the laboratory in one JSON body, and an
   interruption started over.

## The log

`sync_change_log(seq bigserial, organization_id, entity_type, entity_id, op, unit_id, xid xid8, changed_at)`.

Triggers (`calibra_sync_change_log`, `sql/schema-extras.sql`, migration 0122) append a row **in the
writer's own transaction**, so a change and its entry commit or roll back together. The entry says
_which row to look at again_ and in which unit; it carries no data. The pull reads the row as it is at
pull time, so a row changed five times between two pulls is one event with its current state.

`xid` is the id of the transaction that wrote the entry (`pg_current_xact_id()`, 64 bits, never wraps;
the top-level id also inside a savepoint, which `runInTransactionScope` uses). `seq` is only a tiebreak
inside one transaction. `organization_id` is NOT NULL with `ON DELETE CASCADE` (derived operational data,
not evidence); `entity_id` is a soft reference because it outlives the row it names. Every read goes
through `orgDb(organizationId)`.

### Entities (exactly those of the pull and the bootstrap)

| Wire entity type           | Table                                                                | Scope (`unit_id` of the entry) |
| -------------------------- | -------------------------------------------------------------------- | ------------------------------ |
| `asset_type`               | `asset_type` (a global catalog: one entry **per laboratory**)        | the whole laboratory           |
| `customer`                 | `customer` (`lab_organization_id`)                                   | the whole laboratory           |
| `asset`                    | `asset` (`lab_organization_id`)                                      | `unit_id`                      |
| `service`                  | `service`                                                            | `unit_id`                      |
| `reference_standard`       | `reference_standard`, and `reference_standard_certificate_document`  | `unit_id`                      |
| `environmental_limit`      | `environmental_limits`                                               | `unit_id`                      |
| `calibration_job`          | `calibration_job`                                                    | `unit_id`                      |
| `service_order`            | `service_order`                                                      | `unit_id`                      |
| `published_method`         | `calibration_method` (PUBLISHED only: leaving PUBLISHED is a delete) | the whole laboratory           |
| `mass_composition_profile` | `mass_composition_profile` (in the bootstrap, not in the old pull)   | the whole laboratory           |

`packages/db/src/sync-change-log.ts` is the one list; a drift test (`sync-change-log-sql.test.ts`)
fails when a trigger and the list differ, and the API's entity sources are tested against the same list.
The P2-10 narrowing of the offline scope changed what the desktop can _do_ offline, not what it mirrors:
the pull and bootstrap entities are unchanged.

## Reading the log without skipping a row

The cursor is a position `(xid, seq)`, serialised `v3|<xid>|<seq>`. A page is read in **one statement**:

```sql
entries WHERE (xid, seq) > cursor
          AND xid < pg_snapshot_xmin(pg_current_snapshot())
ORDER BY xid, seq LIMIT n + 1
```

`pg_snapshot_xmin` is the lowest transaction id still in flight when the statement's snapshot was taken.

**Claim: a row is never behind the cursor it was handed out after.** Let `S` be the snapshot of a pull,
`X = xmin(S)`.

1. Every transaction with `xid < X` had finished (committed or rolled back) before `S`. A committed one's
   entries are visible to `S`; a rolled back one has none. So the set `V(S) = {entries with xid < X}` is
   complete, and it can never grow: a transaction that writes later either already has an id (so it was in
   flight at `S`, hence `>= X`) or gets a new, larger one.
2. A page returns the first entries of `V(S)` after the cursor, ordered by `(xid, seq)`. The cursor moves to
   the last one returned. Everything of `V(S)` before it was returned (the order is total, nothing is
   skipped inside it); everything not in `V(S)` has `xid >= X`, and `X > ` every returned `xid`, so it sorts
   **after** the cursor.
3. When the page reaches the end of `V(S)` the cursor becomes `(X, 0)`: "every transaction below `X` is
   covered". Sequence numbers start at 1, so every entry of transaction `X` itself sorts after it. This
   also moves the cursor past entries the desktop's unit scope filtered out, so a narrow scope does not
   rescan them on every pull.
4. By induction on pulls, every entry is returned exactly once, in `(xid, seq)` order, whatever order the
   transactions commit in.

The ordering is by transaction _start_, not by commit, and it does not matter: an event is the row as it is
at pull time (read after the entries, so at least as new as the entry), and a later change to the same row
has an entry of its own. A row read newer than its entry is simply sent again by that later entry, and the
desktop's upsert is idempotent.

Why `seq` alone (the first design) is not enough: `bigserial` values are taken at insert time. A
transaction that inserted `seq = 10` and commits after one that inserted `seq = 11` and was pulled leaves
`10` behind the cursor. Ordering by `xid` first and serving only below the in-flight horizon is the fix.

**Cost, stated plainly: latency, never loss.** The horizon is cluster-wide (the oldest write transaction in
flight in _any_ database of the cluster, a read-only one has no id and does not count). A long write
transaction holds it back: desktops keep pulling and see nothing new until it ends. Keep transactions short;
set `idle_in_transaction_session_timeout` (DEPLOYMENT.md). The integration tests wait for the horizon for the
same reason (`waitUntilServable`).

### From the entry to the event

For the distinct rows of a page (in the order their first entry appears) the API looks them up by id with
the desktop's scope (`entity-sources.ts`: the laboratory through `orgDb`, the unit scope the legacy pull
used, **no technician predicate**): found and live is an `upsert`; soft-deleted is a `delete` that keeps the
payload (`deletedAt`); not found (hard-deleted, moved to a unit outside the scope, no longer published, no
longer an active mass profile) is a `delete` with `{ id }`. A row that moves between units writes an
entry for the unit it left (`op = 'delete'`) and one for the unit it joined (`op = 'upsert'`), and each
desktop resolves it against its own scope: the old unit's desktop gets a delete, the new unit's an upsert.
Reassigning a job to another technician stays an upsert, because the pull scope is the unit.

Each event carries `resumeCursor`: the cursor that makes a pull return it again.

## The desktop

- **Delete events** remove the mirror of every entity (`removeLocalMirror`): customers, assets, jobs get
  `deleted_at` (local history keeps pointing at them), standards the `deleted` state, the rest are deleted
  rows. A row with **queued local changes** is skipped and remembered with its `resumeCursor`
  (`sync_skipped_rows`); when its changes settle (a conflict ignored, a rejection) the cursor rewinds to
  just before it and the delete is applied by the next pull. The queued edit meanwhile reaches the cloud
  and comes back as the usual conflict. An upsert of a row that came back into scope clears `deleted_at`.
- **The paged bootstrap.** `POST /api/sync/bootstrap` with `protocolVersion: 3` in the body returns one page
  (`pageToken`, `limit`; default 500, at most 1000 rows) of the session header and a slice of the entities.
  The walk is by entity (in the order of the table above), each by id; the token `b3|<xmin>|<rank>|<lastId>`
  carries the walk position, so the server keeps no state. The first page fixes `xmin`, and the pull cursor
  that follows is `v3|<xmin>|0`: everything of a transaction below `xmin` finished before any page was read,
  so the pages include it; everything of a transaction at or above `xmin` has an entry the pull will serve. A
  row that changes while the pages are being read is read in whichever state a page caught it and sent
  again by the pull; a row deleted meanwhile is skipped by the walk and tombstoned by the pull.
- **Resuming.** Each page is applied in one SQLite transaction together with the ids it delivered and the
  token of the next page (`sync_cursors`, scope `bootstrap-page`). An interrupted bootstrap resumes at the
  next page, also from the periodic push sync (`hasIncompleteBootstrap`). The pull cursor is cleared when
  a bootstrap starts and set only by the last page, which also removes the mirror rows no page delivered
  (deleted, or out of scope, while the desktop could not hear it). A token the cloud refuses restarts
  the bootstrap once.
- **"Bootstrap again."** `GET /api/sync/pull?protocolVersion=3` answers `409 SYNC_RESYNC_REQUIRED` with a
  reason: `no_cursor`, `cursor_format` (an `updatedAt` cursor: a desktop that just upgraded) or
  `cursor_purged`. The desktop bootstraps and pulls once more; a second refusal fails the run, never loops.

## Retention

`purgeSyncChangeLog` (cron `sync-change-log-purge`, daily) deletes entries older than
`SYNC_CHANGE_LOG_RETENTION_DAYS` (default 90) and, in the same statement, records per laboratory the
newest `(xid, seq)` removed in `sync_change_log_purge`. A cursor strictly below it may have missed an
entry (`cursor_purged`); a cursor at or after it has missed none, since everything purged is `<=` it.
A fresh bootstrap's cursor is `(xmin, 0)`, above any horizon.

## Compatibility (REQ-CS-4)

Protocol 1 and 2 desktops send neither `protocolVersion` on the bootstrap body nor on the pull: they get the
old behaviour unchanged (`loadCloudSyncEventsSince`, the one-shot bootstrap), with a `Deprecation: true`
header. A protocol 3 desktop against a cloud that predates it gets the old answers (the field is ignored)
and reads them as before. `SYNC_PROTOCOL_VERSION` is 3; the push wire format did not change. The legacy
path is deleted once `SYNC_MIN_DESKTOP_VERSION` excludes the builds that need it (DEPLOYMENT.md).

## Known limits

- Every write to a mirrored table writes one more row (deduplicated per entity and unit inside a
  transaction; a no-op `UPDATE` writes none). An `asset_type` change writes one row per laboratory (the
  catalog changes rarely).
- Entries written before migration 0122 do not exist: a desktop on protocol 3 always starts from a
  bootstrap.
- The entry order is by transaction start, so two changes that commit in the opposite order of their ids are
  delivered in id order; since every event is the row's state at pull time, the desktop converges either way.

## Tests

`apps/api/src/routes/sync-change-seq.int.spec.ts` (the late-commit case with two real concurrent
transactions, tombstones, scope moves, pages, compatibility, retention),
`apps/api/src/modules/sync/change-log-triggers.int.spec.ts` (what each trigger writes),
`packages/db/src/sync-change-log-sql.test.ts` (migration, schema-extras and entity list agree),
`packages/local-db/src/sync-change-seq.test.ts` and `apps/local-server/src/sync-change-seq.test.ts`
(deletes, pending rows, paged bootstrap, resumption, resync), `packages/contracts/src/sync-change-seq.test.ts`.
