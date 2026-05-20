# Method Builder Inventory

This inventory records the production Method Builder surface introduced in this branch.

## Target Shape

- `packages/method-definition` owns the method definition model, runtime validation, normalization, compilation, preview contracts, fingerprints, and diagnostics.
- Backend owns persistence, authorization, audit, compile/preview/publish endpoints, immutable published artifacts, and job snapshot creation.
- The web Method Builder owns draft editing only. It calls backend compile/preview/publish routes instead of defining method validity in React components.
- Published methods are compiled artifacts with an engine version, options fingerprint, method fingerprint, diagnostics, and publication evidence.

## Ownership Map

| Area                   | Files                                                                                   | Responsibility                                                                                                                                                          |
| ---------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Method definition core | `packages/method-definition/**`                                                         | Pure TypeScript core for shape safety, schemas, normalization, formula compilation, preview execution, diagnostics, fingerprints, and immutable compiled artifacts.     |
| Method API             | `apps/api/src/routes/methods.ts`                                                        | CRUD, workflow transitions, server-side compile/preview/publish, persisted compiled method artifacts, audit log integration, and route-level permissions.               |
| Method persistence     | `packages/db/src/schema.ts`, `packages/db/drizzle/0016_method_definition.sql`           | Stores editable method data plus compiled artifact metadata: compiled method JSON, method fingerprint, engine metadata, compile timestamp, and publication evidence.    |
| Method Builder UI      | `apps/web/src/components/method-builder/**`, `apps/web/src/routes/dashboard/methods/**` | Production draft editor for identity, inputs, variables, formulas, validations, uncertainty components, certificate content, compile diagnostics, preview, and publish. |
| Method runtime helpers | `apps/web/src/components/method-runtime/**`                                             | Shared execution/display helpers for table inputs, mass composition, weighing ranges, and formula context evaluation used outside the builder UI.                       |
| Job execution UI       | `apps/web/src/routes/dashboard/jobs/$id/execute.tsx`                                    | Captures technician inputs, environmental data, standards, table data, and local result display.                                                                        |
| Job backend            | `apps/api/src/lib/jobs.ts`, `apps/api/src/routes/jobs.ts`                               | Creates method snapshots from published methods, validates required asset specs, and stores execution data/results/snapshots.                                           |
| Certificate rendering  | `packages/documents/src/CertificateHtml.tsx`                                            | Reads method snapshots, results, formula reporting metadata, and certificate content to render certificate sections.                                                    |

## Current Method Model

The editable method record still persists these fields while the compiled artifact is being introduced:

- Identity/workflow: `id`, `organizationId`, `assetTypeId`, `name`, `description`, `version`, `status`, `parentId`, actor/timestamp fields.
- `dataFields`: input definitions with text, number, select, and table types.
- `variableBindings`: mappings from data fields, table columns/statistics, environment, and standards into formula variables.
- `formulas`: ordered expressions with `outputKey`, optional label/unit, and certificate reporting metadata.
- `validations`: structured left/operator/right acceptance rules.
- `uncertaintyParams`: Type B uncertainty components.
- `certificateContent`: procedure code, reference standard display controls, uncertainty/mass display controls, and custom sections.

Current statuses:

- `DRAFT`
- `PENDING_APPROVAL`
- `TECHNICAL_REVIEWED`
- `PUBLISHED`
- `ARCHIVED`

## Runtime Semantics

- Formula and validation semantics should move toward backend/core ownership.
- The UI can preview and display results, but publishability is decided by the server compile path.
- Default variable bindings are generated from numeric fields and numeric table columns.
- Environment variables are injected as `env_temperature`, `env_humidity`, and `env_pressure`.
- Table bindings expose whole numeric columns and statistics: `mean`, `sample_stddev`, `count`, `min`, `max`.
- Formula evaluation is ordered; later formulas can use previous formula outputs.
- Structured validations evaluate left and right expressions independently.

## Implemented In This Branch

1. `packages/method-definition`
   - Runtime-safe draft parsing.
   - Metadata safety checks.
   - Normalization and deterministic fingerprinting.
   - Formula compilation using an injected public math-engine instance.
   - Preview execution and diagnostics.
   - Immutable compiled method artifact.

2. Backend compile/preview/publish flow
   - `POST /api/methods/compile`.
   - `POST /api/methods/preview`.
   - Publish path recompiles server-side and persists the compiled artifact.
   - Publication evidence records method fingerprint, engine metadata, preview results, diagnostics, and reason for change.

3. Production Method Builder UI
   - Method create/edit routes render `apps/web/src/components/method-builder`.
   - Save persists editable draft data.
   - Compile, preview, and publish call backend routes.
   - The previous visual builder implementation was removed.

## Remaining Integration Work

- Job execution should use the compiled method snapshot as the execution source of truth.
- Certificate rendering should read from a compiled method/result projection for new jobs.
- API execution endpoints should recompute or verify submitted results server-side before final storage.
