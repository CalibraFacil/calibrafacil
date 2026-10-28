# Job status guard (migration 0119) and audited status repair

Runbook moved out of [`DEPLOYMENT.md`](../../DEPLOYMENT.md#runbooks) (roadmap 2 G5).

Migration `0119_job_status_transition_guard` makes Postgres enforce the calibration job state machine
(`packages/schemas/src/job-transitions.ts`) with a trigger on `calibration_job`:

- an `UPDATE` that changes `status` must be a move the table allows; anything else (for example an
  `APPROVED` job back to `DRAFT`) fails with `calibra: illegal job transition APPROVED -> DRAFT`,
  SQLSTATE `CF001`. Writing the same status again is always accepted;
- an `INSERT` is accepted only in `DRAFT`.

**Existing data is not re-validated.** Rows already in a status the table would not produce do not block the
migration; only future status changes and inserts are checked. The migration is idempotent and takes a short
lock on `calibration_job`.

**Audited data repair.** A repair that must break the rule (a job stuck in a wrong status after an incident)
runs in one transaction that sets the hatch with `SET LOCAL`, so it reverts at `COMMIT`/`ROLLBACK`:

```sql
BEGIN;
SET LOCAL calibra.allow_status_repair = 'on';
-- an APPROVED or SUPERSEDED job is also frozen by the immutability trigger (migration 0115);
-- repairing one needs the second hatch as well:
-- SET LOCAL calibra.allow_audit_rewrite = 'on';
UPDATE calibration_job SET status = 'REVIEW' WHERE id = 123;
-- record the reason in job_audit_log, then:
COMMIT;
```

Run it on the **owner connection** (`DATABASE_OWNER_URL`, the role that owns the tables): since migration
0130 the hatches work for a session of the table owner only, so `calibra_app` (the application) that sets
`calibra.allow_status_repair` or `calibra.allow_audit_rewrite` lifts nothing. `calibra.allow_audit_rewrite`
(the demo seed, the records purge) lifts the guard too. Do not set either with plain `SET` or in a
connection default. When the state machine itself changes, regenerate the function with
`pnpm --filter @calibra-facil/db gen:job-transitions-sql` and ship it in a new migration; a unit test fails
while the migration and `sql/schema-extras.sql` differ from the table.
