# Applying migration 0118 (organization on every tenant table)

Runbook moved out of [`DEPLOYMENT.md`](../../DEPLOYMENT.md#runbooks) (roadmap 2 G5).

Migration `0118_organization_id_everywhere` adds `organization_id` to 37 tables (16 audit logs, the finance
and service-order children, `job_standard`, ...), backfills it from the parent row, adds the foreign key to
`organization`, an index per table, 14 `UNIQUE (id, organization_id)` constraints on the parents and 29
composite foreign keys (see `docs/architecture/tenancy.md`). It is one transaction and idempotent, so a
failed run rolls back whole and can be repeated. What to know before running it:

- **Ship it together with the app.** The 16 audit logs get `CHECK (organization_id IS NOT NULL) NOT VALID`:
  every new audit row must name its laboratory. An old API or worker instance still running after the
  migration inserts audit rows without one and fails. Drain the old API and worker (stop them, or let the
  deploy swap all instances), apply the migration, start the new version; do not run old and new side by
  side.
- **Run it off-peak, with a lock timeout.** The `ALTER TABLE`s take `ACCESS EXCLUSIVE` locks (the backfill
  `UPDATE`s also lock the rows they touch) and hold them to the end of the transaction. Fail fast instead of
  queueing behind a long query:

  ```bash
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
    -c "SET lock_timeout = '5s'" \
    -f packages/db/drizzle/0118_organization_id_everywhere.sql
  ```

  (Or `ALTER ROLE <app role> SET lock_timeout = '5s'` for the run and `ALTER ROLE <app role> RESET lock_timeout`
  after, if you apply it through `init`.) On `lock_timeout` the whole migration rolls back; retry in a quieter
  moment. Applying it by `psql` leaves the drizzle bookkeeping behind; the next `init` re-applies it, which is a
  no-op because every step checks first.

- **Check the sizes first.** The backfill rewrites every row of the 37 tables once, and the parents build a
  unique index:

  ```sql
  SELECT c.relname, c.reltuples::bigint AS rows, pg_size_pretty(pg_total_relation_size(c.oid)) AS size
    FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace
     AND c.relname IN ('calibration_job', 'service_order', 'asset', 'billing_document', 'receivable_installment',
                       'service_order_quote', 'service_order_execution', 'job_audit_log', 'asset_audit_log',
                       'customer_audit_log', 'payment_receipt', 'billing_document_item')
   ORDER BY c.reltuples DESC;
  ```

  If `calibration_job`, `service_order` or `asset` hold hundreds of thousands of rows (or any table holds
  millions), **pre-build the `UNIQUE (id, organization_id)` indexes `CONCURRENTLY`** the day before. They do
  not block writes, and the migration adopts an index that already carries the constraint's name
  (`ADD CONSTRAINT ... UNIQUE USING INDEX`), so nothing is built under lock. Run each statement on its own
  (`CREATE INDEX CONCURRENTLY` cannot run inside a transaction); if one is interrupted it leaves an `INVALID`
  index, `DROP INDEX CONCURRENTLY` it and repeat:

  ```sql
  CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS calibration_job_id_org_uidx ON calibration_job (id, organization_id);
  CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS service_order_id_org_uidx ON service_order (id, organization_id);
  CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS asset_id_org_uidx ON asset (id, lab_organization_id);
  CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS billing_document_id_org_uidx ON billing_document (id, organization_id);
  CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS billing_group_id_org_uidx ON billing_group (id, organization_id);
  CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS commercial_agreement_id_org_uidx ON commercial_agreement (id, organization_id);
  CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS service_id_org_uidx ON service (id, organization_id);
  CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS organization_unit_id_org_uidx ON organization_unit (id, organization_id);
  CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS reference_standard_id_org_uidx ON reference_standard (id, organization_id);
  CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS asset_oot_event_id_org_uidx ON asset_oot_event (id, lab_organization_id);
  CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS calibration_request_id_org_uidx ON calibration_request (id, organization_id);
  ```

  **Before running the migration, check that every pre-built index is valid.** An interrupted
  `CREATE INDEX CONCURRENTLY` leaves an `INVALID` index under the constraint's name; it enforces nothing, and
  its name would clash with the one the constraint creates. The migration drops such a leftover itself, but
  look first (and `indisready` must be true too):

  ```sql
  SELECT c.relname AS index_name, i.indrelid::regclass AS table_name, i.indisvalid, i.indisready
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
   WHERE c.relnamespace = 'public'::regnamespace AND c.relname LIKE '%\_id\_org\_uidx'
   ORDER BY i.indisvalid, c.relname;
  ```

  Every row must show `indisvalid = t`. Drop each `f` row concurrently (it never blocks writes) and build it
  again with the statement above:

  ```sql
  SELECT format('DROP INDEX CONCURRENTLY IF EXISTS public.%I;', c.relname)
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
   WHERE c.relnamespace = 'public'::regnamespace AND c.relname LIKE '%\_id\_org\_uidx' AND NOT i.indisvalid
  \gexec
  ```

  The other three parents (`receivable_installment`, `service_order_execution`, `service_order_quote`) gain
  their `organization_id` in this very migration, so their index is built by it.

- **The composite foreign keys are added `NOT VALID`.** Postgres enforces them for every new row at once, and
  the migration has already checked the existing rows (it raises, naming the table and the count, if any child
  points at another laboratory's row), so no second scan runs under the lock. After the deploy, mark them
  validated. Each `VALIDATE CONSTRAINT` runs as **its own statement in autocommit**, so every one takes only a
  `SHARE UPDATE EXCLUSIVE` lock (reads and writes continue) and releases it before the next starts; locks
  never accumulate. `\gexec` sends each generated statement separately, and re-running it is harmless (it
  lists only what is still not validated):

  ```sql
  SELECT format('ALTER TABLE %s VALIDATE CONSTRAINT %I;', conrelid::regclass, conname)
    FROM pg_constraint
   WHERE contype = 'f' AND NOT convalidated AND conname LIKE '%\_tenant\_fk'
   ORDER BY conrelid::regclass::text, conname
  \gexec
  ```

  Run it with `psql "$DATABASE_URL" -v ON_ERROR_STOP=1` (without `-1`/`--single-transaction`, which would put
  them all back in one transaction).

- **Orphans.** A row of a non-audit child table with no parent (real corruption) makes the migration raise
  and apply nothing: fix the rows it names and run it again. An audit-log row whose entity was hard-deleted is
  expected: it is attributed from the deleted row's own snapshot when it carries one, otherwise it keeps
  `organization_id` NULL and the migration only prints a `NOTICE` with the count per table. Those rows are
  invisible to tenant-scoped reads; once they are attributed or archived,
  `ALTER TABLE <log> VALIDATE CONSTRAINT <log>_organization_id_required` makes the guarantee complete.
