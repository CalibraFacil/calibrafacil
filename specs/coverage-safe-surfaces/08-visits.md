# Mini-spec: visit-status roll-forward coverage

Target: `apps/api/src/lib/visits.ts` (`syncVisitStatusFromJobs`)
Test file: `apps/api/src/lib/__tests__/visits.spec.ts` (Vitest — `.spec.ts`)

## Context

A _visit_ lifecycle state machine (PROPOSED/CONFIRMED → IN_PROGRESS → COMPLETED),
DISTINCT from the regulated calibration-approval state machine (that one is
pair-don't-loop and is NOT touched here). DB-coupled: mock `@calibra-facil/db` with
`vi.mock` so `db.select(...).from(...).where(...)` returns scripted rows and `db.update`
is a spy. Drive the logic via the mocked job rows. Do NOT hit a real database.

Implementer note: mirror the chained drizzle builder the module uses
(`select().from().where().limit()` for the visit; `select().from().where()` for jobs;
`update().set().where()`). Assert the **next status written** (or that no update ran).

## Acceptance Criteria

- REQ-VISIT-001: IF `syncVisitStatusFromJobs` receives a null/undefined visitId, THEN
  the function SHALL return without querying (no db call).
- REQ-VISIT-002: IF the visit row does not exist, THEN the function SHALL return
  without updating.
- REQ-VISIT-003: IF the visit status is `"CANCELLED"` or `"COMPLETED"`, THEN the
  function SHALL NOT update it (terminal — never downgraded or re-touched).
- REQ-VISIT-004: IF the visit has zero child jobs, THEN the function SHALL NOT update.
- REQ-VISIT-005: WHEN every job is settled (`APPROVED`/`SUPERSEDED`/`CANCELED`) AND at
  least one is `APPROVED` or `SUPERSEDED`, the function SHALL set the visit to
  `"COMPLETED"`.
- REQ-VISIT-006: IF every job is settled but all are `CANCELED` (none approved/
  superseded), THEN the function SHALL NOT set `"COMPLETED"`.
- REQ-VISIT-007: WHEN the visit is `"PROPOSED"` or `"CONFIRMED"` and at least one job
  has left `DRAFT` (but not all settled-with-approval), the function SHALL set the
  visit to `"IN_PROGRESS"`.
- REQ-VISIT-008: IF all jobs are still `DRAFT`, THEN the function SHALL NOT change a
  PROPOSED/CONFIRMED visit (no update issued).
- REQ-VISIT-009: WHEN the computed next status equals the current status, the function
  SHALL NOT issue an update.
