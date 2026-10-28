# Records retention (purge of soft-deleted laboratories)

Runbook moved out of [`DEPLOYMENT.md`](../../DEPLOYMENT.md#runbooks) (roadmap 2 G5).

Regulated records (technical records, certificates, audit and event logs, reference standards, NC/CAPA,
service orders, finance documents) are kept at least 10 years: `organization.retention_years` defaults
to 10 and the database refuses anything below 5. A laboratory that holds records is never deleted for
real: `pnpm --dir apps/api soft-delete-lab --slug <slug> --reason "<why>"` soft-deletes and suspends it
(`organization.deleted_at`), and Postgres refuses a `DELETE` of a laboratory organization.
`docs/architecture/records-retention.md` is the inventory of what counts as evidence and of every
foreign key into it.

The `records-purge` cron (weekly) is the only thing that can remove such a
laboratory, and it is **off by default**:

- `RECORDS_PURGE_ENABLED` unset or anything but `true`: the cron answers immediately and touches nothing.
- `RECORDS_PURGE_ENABLED=true`: it selects the soft-deleted laboratories that are not under
  `organization.legal_hold` and whose newest record (their own deletion included) is older than their
  `retention_years`, and **only logs** what it would purge (`[records-purge] dry run: would purge ...`).
- `RECORDS_PURGE_MODE=execute` as well: for each of those it writes `records.purge.started` to
  `platform_event_log`, deletes the laboratory and everything it owns in one transaction, then writes
  `records.purge.completed` (or `failed`). The platform event log is append-only and survives the purge.

Run it in dry-run for a while and review the log before switching to `execute`. The purge removes
database rows only: certificate PDFs and attachments in object storage are not deleted by it. Set
`legal_hold = true` on an organization (with `legal_hold_reason`) to exclude it, whatever its age.

The laboratory's owner can also soft-delete it from **Configurações → Organização → Excluir organização**
(`POST /api/organization/soft-delete`, owner only, typed name plus a reason). That locks the laboratory, signs
the owner out and revokes its API keys; the keys of a suspended or soft-deleted laboratory are refused with
`organization_suspended` / `organization_deleted`, and its issued certificates keep verifying at `/verify`.

**Applying migration 0117.** It drops and re-adds 42 foreign keys (the ones that cascaded a delete into
evidence, now `RESTRICT`) in a single transaction. Each `ALTER TABLE` takes an `ACCESS EXCLUSIVE` lock on the
referencing table and a `SHARE ROW EXCLUSIVE` lock on the referenced one (`organization`, `customer`, `asset`,
`reference_standard`, ...), and every re-added key is re-validated against the existing rows. On a database
with a lot of evidence this holds those locks for as long as the validation scans take, and anything that
writes to those tables waits. Run it in a low-traffic window (the app can stay up; writes queue behind it).
It is idempotent, so a failed run rolls back whole and can simply be repeated.
