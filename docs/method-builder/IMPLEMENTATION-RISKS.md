# Method Builder Implementation Risks

This risk register is scoped to making the new Method Builder the production method authoring and publishing path.

## Highest-Risk Items

### 1. Browser-only calculation semantics

Current execution screens still evaluate formulas and validations in the browser for technician feedback and result submission.

Risk:

- Published behavior can diverge between UI preview, job execution, and certificate rendering if backend/core does not become the source of truth.
- Auditability is weak if execution stores browser-submitted results without server-side verification.

Mitigation:

- Keep compile and preview in `packages/method-definition` plus API routes.
- During publish, persist a compiled artifact with deterministic diagnostics.
- During job execution, compute or verify results server-side before storing them.

### 2. Existing job snapshots

Existing `calibration_job.method_snapshot` rows store the previous editable method shape directly. Certificates and portal views read this shape.

Risk:

- Changing snapshot shape in place can break already approved certificates.
- Mutating existing job snapshots would risk losing reproducibility.

Mitigation:

- Do not mutate existing job snapshots.
- Add a version discriminator for compiled snapshots produced by new jobs.
- Keep read adapters until job execution and certificate rendering consume compiled artifacts for new records.

### 3. Method model duplication

Method types currently exist in multiple places: database schema, shared schemas, web draft types, and the new method-definition core.

Risk:

- A field can be accepted by UI but rejected by backend/core.
- UI-local assumptions can leak into publish behavior.

Mitigation:

- Make `packages/method-definition` the canonical source for compiled method contracts.
- Keep web draft adapters thin and explicit.
- Add tests around adapter output and server compile behavior.

### 4. Formula ordering and variables

Formulas are ordered and can reference previous formula outputs. Default variable bindings are inferred from fields and table columns when missing.

Risk:

- Compiler ordering, duplicate output keys, or unresolved references can change method behavior.
- Missing variable bindings can produce different execution contexts.

Mitigation:

- Compile should detect duplicate output keys, unresolved references, reserved words, cycles, and invalid forward references.
- Preview scenarios should cover nominal and boundary data before publish.
- Persist normalized formulas and formula fingerprints for review.

### 5. Standards and mass-unit behavior

Job execution converts selected standard values and mass data for storage/display. Method fields also support mass composition and weighing range metadata.

Risk:

- Preview/compile may ignore mass-unit normalization that happens across UI and shared helpers.
- Certificates can display incorrect units if result normalization is not captured in the artifact.

Mitigation:

- Include unit policy and display policy in compiled artifacts.
- Add compile diagnostics for mass-specific column roles and missing target columns.
- Test preview with balance/mass seed methods before production use.

### 6. Certificate rendering dependencies

Certificate rendering relies on method formulas, formula reporting metadata, `certificateContent`, and job results.

Risk:

- Artifacts that rename result roles or omit display metadata can break certificate sections.
- Special-case rendering can silently stop applying.

Mitigation:

- Define a certificate projection as part of the compiled artifact/result model.
- Add fixture tests for representative certificates.

### 7. Workflow and audit parity

Methods enforce draft-only editing, review separation, publishing, archiving, new-version cloning, and audit logs in `apps/api/src/routes/methods.ts`.

Risk:

- New compile/preview/publish paths can accidentally bypass role gates, reviewer/approver separation, or audit reason requirements.

Mitigation:

- Reuse existing permission middleware and audit patterns.
- Treat compile and preview as non-mutating.
- Treat publish as the only action that freezes an artifact.
- Add route tests for role separation and status transitions.

## Release Checklist

- Compile rejects invalid method drafts.
- Publish requires successful compile, preview, fingerprint, and publication evidence.
- Backend recompiles drafts and never trusts a compiled artifact from the client.
- Published method artifacts are immutable.
- Job execution uses a compiled method snapshot for new jobs.
- Certificate rendering has a compiled artifact/result projection.
- Adversarial core tests cover metadata safety, unknown fields, formula cycles, invalid variables, invalid criteria, and non-finite values.
