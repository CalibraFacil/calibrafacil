# Evidence immutability: privileges and the owner-only hatch (migration 0130)

Runbook moved out of [`DEPLOYMENT.md`](../../DEPLOYMENT.md#runbooks) (roadmap 2 G5).

ISO/IEC 17025 7.5.2 and 8.4: the history of a record must not be rewritable by the application.
Migration `0130_evidence_privileges_owner_hatch` (roadmap 2, B1) makes that a property of the database:

- **Privileges.** `calibra_app` has no `UPDATE`, `DELETE` or `TRUNCATE` on the append-only evidence tables
  (the `*_audit_log` tables, `organization_event_log`, `integration_event_log`, `service_order_event_log`,
  `issued_certificate_snapshot`) and no `UPDATE` / `TRUNCATE` on `certificate_input`; it keeps `INSERT` and
  `SELECT`. The list is `packages/db/src/evidence-tables.ts`; the `REVOKE` block is generated from it
  (`pnpm --filter @calibra-facil/db gen:rls-sql evidence`) and repeated in `sql/schema-extras.sql`. A drift test
  fails when an audit or event log is added without being classified. Left to the triggers alone, each with
  the reason in that file: `calibration_job` (UPDATEd until approval), `certificate_input` `DELETE` (the revert
  of an approval), `platform_event_log` (the public-signup reservation row) and `organization`.
  The `ON DELETE SET NULL` actions of foreign keys keep working: Postgres runs them as the table owner.
- **The hatches are the owner's.** `calibra.allow_audit_rewrite`, `calibra.allow_status_repair` and
  `calibra.allow_org_purge` only take effect when the session user and the current user are the owner of the
  tables or members of that role (`calibra_session_is_owner()`). The runners are therefore the owner
  connection only: the records purge (`records-purge.ts`, `removeLabOrganization`), the demo seed, an
  operator's audited repair in `psql` as the owner, and the test harness. A deployment whose `DATABASE_URL` is
  the owner (`DATABASE_RLS_MODE=shadow`) has no protection: use the role split.

- **Hash chain (migration 0131).** `job_audit_log` carries a per-organization hash chain: `chain_seq`,
  `prev_hash` and `row_hash = sha256(prev_hash || canonical row)`, assigned by a `BEFORE INSERT` trigger that
  takes `pg_advisory_xact_lock(hashtextextended('job_audit_log:<organization>', 7041))` to the end of the
  transaction, so concurrent writers of one laboratory are serialised and cannot fork it (a unique index on
  `(organization_id, chain_seq)` refuses a fork even under REPEATABLE READ). Cost: transactions that write an
  audit row for the same laboratory run one after the other from that insert on; write the audit row last in a
  transaction (a row lock taken after it, against another transaction that takes it before, is a deadlock that
  Postgres detects and aborts). The migration chains the existing rows per organization in id order. The
  **`audit-chain-verify` cron** (daily, 04:45 UTC) recomputes every laboratory's chain, records a checkpoint of
  each intact head in `platform_event_log` (`audit.chain.verified`; this is the hook for an external timestamp,
  roadmap 2 B4) and, on a break (`row_hash_mismatch`, `prev_hash_mismatch`, `sequence_gap`, `unchained_row`,
  or `checkpoint_missing` / `checkpoint_mismatch` for a deleted or replaced tail), writes `audit.chain.broken`
  to `platform_event_log`, `audit.chain_broken` to the laboratory's event log and notifies its admins, once per
  distinct break; the run itself fails until a human resolves it. On demand:
  `pnpm --dir apps/api verify-audit-chain [--org <organization id> | --slug <slug>] [--record]` (read-only
  unless `--record`; exit code 1 on a break). Nothing is repaired automatically. The demo seed re-seals the
  chain after back-dating (`calibra_audit_chain_backfill(..., p_rebuild => true)`, owner only); do not use it on
  real data except as a deliberate, documented repair.

**Applying it.** The migration is idempotent and sets a 5 s lock timeout. Existing rows are untouched. After
it, a statement that the application should never issue (an `UPDATE` of an audit row) fails with
`permission denied for table ...`; the integration tier runs as `calibra_app`, so a legitimate path that lost
its privilege fails a test.
