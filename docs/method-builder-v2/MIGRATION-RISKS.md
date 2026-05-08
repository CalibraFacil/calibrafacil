# Method Builder v2 Migration Risks

This risk register is scoped to moving from the current method builder to a v2 architecture with `packages/method-definition`, backend compile/preview/publish, Method Builder v2 on method create/edit routes, and migration to draft only.

## Highest-Risk Items

### 1. Browser-only calculation semantics

Current formula and validation evaluation is implemented in `apps/web/src/components/method-builder/math-runtime.ts` and reused by `apps/web/src/routes/dashboard/jobs/$id/execute.tsx`. The API accepts `results` submitted by the browser during execute/submit.

Risk:

- Published v2 behavior could diverge between UI preview, job execution, and certificate rendering if backend/core does not become the source of truth.
- Auditability is weak if server-side publish does not compile and freeze the executable definition.

Mitigation:

- Implement v2 compile and preview in `packages/method-definition` plus API routes before UI v2.
- During publish, persist a compiled artifact with deterministic diagnostics.
- During job execution, compute or verify results server-side before storing them.

### 2. Legacy snapshots must remain readable

Existing `calibration_job.method_snapshot` stores the legacy shape directly. Certificates and portal views read this shape.

Risk:

- Changing snapshot shape in place can break historical certificates.
- Migrating existing job snapshots would risk losing reproducibility.

Mitigation:

- Do not mutate existing job snapshots.
- Add a version discriminator for v2 snapshots/artifacts.
- Keep certificate rendering adapters for both legacy and v2 snapshots.

### 3. Migration must not auto-publish

Legacy method data can include loosely validated JSONB and legacy validation expressions that are normalized at read/evaluation time.

Risk:

- Auto-publishing migrated methods could approve definitions with changed semantics, unsupported bindings, missing certificate metadata, or different numeric behavior.

Mitigation:

- Legacy migration creates `DRAFT` v2 methods only.
- Store migration diagnostics and source legacy identifiers.
- Require explicit compile, technical review, and quality approval before v2 publish.

### 4. Method model duplication

Method types currently exist in at least three places: `packages/db/src/schema.ts`, `packages/schemas/src/index.ts`, and `apps/web/src/components/method-builder/types.ts`.

Risk:

- v2 changes can be applied to one type surface but not another.
- UI-local assumptions can leak into backend contracts.

Mitigation:

- Make `packages/method-definition` the canonical source for v2 types and schemas.
- Export API-safe schemas from the package.
- Keep legacy adapters explicit and covered by tests.

### 5. Formula ordering and variable compatibility

Legacy formulas are evaluated in order and can reference previous formula outputs. Default variable bindings are inferred from fields and table columns when missing.

Risk:

- A v2 compiler that reorders, optimizes, or validates formulas differently may reject or change existing methods.
- Missing or duplicate variable bindings can produce different contexts after migration.

Mitigation:

- Preserve ordered formula evaluation in v2 unless a method explicitly opts into a new graph model.
- Compile should detect duplicate output keys, unresolved references, reserved words, and forward references.
- Migration should materialize effective legacy bindings into the v2 draft.

### 6. Standards and mass-unit behavior

Job execution converts selected standard values and mass data for storage/display. Method fields also support mass composition and weighing range metadata.

Risk:

- V2 preview/compile may ignore mass-unit normalization that currently happens across UI and shared helpers.
- Certificates can display incorrect units if result normalization and denormalization are not captured in the artifact.

Mitigation:

- Include unit policy and display policy in compiled v2 artifacts.
- Add compile diagnostics for mass-specific column roles and missing target columns.
- Test v2 preview with existing balance/mass seed methods before enabling publish.

### 7. Certificate rendering dependencies

`packages/documents/src/CertificateHtml.tsx` relies on method formulas, formula reporting metadata, `certificateContent`, and job results. It also contains balance-like/FOR 50/51 rendering behavior.

Risk:

- V2 artifacts that rename result roles or omit display metadata can break certificate sections.
- Special-case rendering can silently stop applying.

Mitigation:

- Define a v2 certificate projection as part of the compiled artifact.
- Keep legacy rendering code until all historical certificates use the adapter path.
- Add fixture tests for representative legacy and v2 certificate jobs.

### 8. Workflow and audit parity

Legacy methods enforce draft-only editing, review separation, publishing, archiving, new-version cloning, and audit logs in `apps/api/src/routes/methods.ts`.

Risk:

- New v2 endpoints can accidentally bypass feature gates, role gates, reviewer/approver separation, or audit reason requirements.

Mitigation:

- Reuse existing permission middleware and audit patterns.
- Treat compile as non-mutating, preview as non-mutating, and publish as the only action that freezes an artifact.
- Add route tests for role separation and status transitions.

## Migration Checklist

- Inventory all legacy method JSON shapes present in seed data and production exports before implementing destructive schema changes.
- Build `legacyMethodToV2Draft` as a pure function in `packages/method-definition`.
- Make migration idempotent by recording source method id/version and target v2 draft id.
- Preserve source method status; migrated output is always draft.
- Compile migrated draft and store diagnostics, but do not publish.
- Block v2 publish when compile diagnostics contain errors.
- Allow warnings to publish only if review policy explicitly permits them.
- Keep historical job/certificate readers intact until v2 execution and certificate projections have parity.
- Add tests for legacy validation expression normalization.
- Add tests for table variables, environment variables, standard variables, ordered formulas, and certificate reporting metadata.

## Assumptions To Validate

- `packages/method-definition` does not exist yet and will be introduced as a new workspace package.
- Backend compile/preview/publish endpoints are not implemented yet in the current branch.
- UI v2 now owns method create/edit routes; the existing `apps/web/src/components/method-builder` remains present for execution/read paths that have not yet moved to compiled v2 snapshots.
- Migration should target method definitions only, not existing calibration jobs or certificates.
