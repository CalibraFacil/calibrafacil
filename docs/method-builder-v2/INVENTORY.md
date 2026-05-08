# Method Builder v2 Inventory

This inventory is based on local inspection of the current branch. It records the existing method surfaces that v2 must account for before introducing a shared `packages/method-definition` core.

## Target v2 Shape

- `packages/method-definition` owns the method definition model, validation, normalization, compilation, preview evaluation contracts, migration helpers, and compatibility adapters.
- Backend owns persistence, authorization, audit, compile/preview/publish endpoints, immutable published artifacts, and job snapshot creation.
- UI v2 replaces the method create/edit screens and consumes backend compile/preview/publish routes instead of defining method validity in React components.
- Legacy method migration is explicit and draft-only. It should not auto-publish migrated definitions or mutate historical job snapshots.

## Current Ownership Map

| Area | Current files | Current responsibility | v2 action |
| --- | --- | --- | --- |
| Method persistence | `packages/db/src/schema.ts`, `packages/db/drizzle/0000_late_donald_blake.sql`, `packages/db/drizzle/0006_method_certificate_content.sql`, `packages/db/drizzle/0015_method_variable_bindings.sql` | `calibration_method` stores method JSONB fields and workflow metadata. | Keep legacy table readable; add v2 persistence/artifact tables or columns only after defining compiled artifact shape. |
| Method API | `apps/api/src/routes/methods.ts` | CRUD, approval workflow, version cloning, audit log, list/get routes. | Add v2 routes for compile, preview, publish, and migration-to-draft; keep legacy route behavior stable during transition. |
| Shared schemas | `packages/schemas/src/index.ts` | Zod schemas for method fields, formulas, validations, variable bindings, certificate content, snapshots, job execution payloads. | Move or mirror method-definition schemas into `packages/method-definition`; export compatibility schemas for API use. |
| UI method builder | `apps/web/src/components/method-builder/**`, `apps/web/src/components/method-builder-v2/**`, `apps/web/src/routes/dashboard/methods/**` | Legacy builder still exists for shared helpers, while method create/edit routes now render Method Builder v2. | Continue moving semantics out of React. V2 UI should remain a draft editor that calls backend preview/compile/publish. |
| Job execution UI | `apps/web/src/routes/dashboard/jobs/$id/execute.tsx` | Builds formula context, evaluates formulas/validations client-side, stores `results` sent to API. | Backend compile/preview should become source of truth before UI v2 depends on v2 definitions. |
| Job backend | `apps/api/src/lib/jobs.ts`, `apps/api/src/routes/jobs.ts` | Creates method snapshots from published methods, validates required asset specs, stores execution data/results/snapshots. | Use compiled v2 artifact when creating new job snapshots; keep legacy snapshot reader for existing jobs. |
| Certificate rendering | `packages/documents/src/CertificateHtml.tsx` | Reads method snapshot formulas/certificate content/results to render certificate sections. | Add renderer adapter from v2 compiled artifact/result model; avoid breaking legacy snapshot rendering. |
| Public docs | `apps/docs/src/content/docs/metodos/**`, `apps/docs/src/content/docs/motor-matematico.mdx`, `apps/docs/src/content/docs/validacao-motor-matematico.mdx` | User-facing description of current method lifecycle, formulas, fields, criteria, math engine validation. | Update only after v2 contracts and migration behavior are implemented. |

## Existing Legacy Method Model

The legacy method definition is split across TypeScript types in `packages/db/src/schema.ts`, Zod schemas in `packages/schemas/src/index.ts`, and UI-local types in `apps/web/src/components/method-builder/types.ts`.

Current method fields:

- Identity/workflow: `id`, `organizationId`, `assetTypeId`, `name`, `description`, `version`, `status`, `parentId`, actor/timestamp fields.
- `dataFields`: input definitions with text, number, select, and table types.
- `variableBindings`: explicit or default mappings from data fields, table columns/statistics, environment, and standards into formula variables.
- `formulas`: ordered expressions with `outputKey`, optional label/unit, and certificate reporting metadata.
- `validations`: structured left/operator/right rules, with legacy expression normalization still supported.
- `uncertaintyParams`: Type B uncertainty components.
- `certificateContent`: procedure code, reference standard display controls, uncertainty/mass display controls, and custom sections.

Current statuses:

- `DRAFT`
- `PENDING_APPROVAL`
- `TECHNICAL_REVIEWED`
- `PUBLISHED`
- `ARCHIVED`

Current publish behavior:

- Only drafts are editable.
- Approval workflow is gated by `approval_workflow`.
- Technical review requires admin role.
- Quality approval/publish requires owner role and separate reviewer/approver users.
- Publishing archives previous published versions with the same organization/name.
- New versions are cloned from published methods into a new draft.

## Existing Runtime Semantics

Formula and validation semantics currently live in the web app:

- `apps/web/src/components/method-builder/math-runtime.ts` creates `@calibra-facil/math-engine` with decimal numeric mode.
- Default variable bindings are generated from numeric fields and numeric table columns.
- Environment variables are injected as `env_temperature`, `env_humidity`, and `env_pressure`.
- Table bindings expose whole numeric columns and statistics: `mean`, `sample_stddev`, `count`, `min`, `max`.
- Formula evaluation is ordered; later formulas can use previous formula outputs.
- Structured validations evaluate left and right expressions independently.
- Legacy validation objects with a single `expression` are normalized into structured rules.

Execution currently evaluates formulas in the browser and submits `results` to the API:

- `apps/web/src/routes/dashboard/jobs/$id/execute.tsx` builds the formula context from form data, environment, and selected standards.
- The API stores submitted `results` without recomputing formulas server-side in `execute`/`submit`.
- The API normalizes persisted method data for mass units and strips `asset_spec` fields before storing job data.

This is the main architectural gap v2 should close: compiled definitions and preview/evaluation should be owned by backend/core, not by UI-only helpers.

## Existing Snapshot Contracts

`MethodSnapshot` is stored on every `calibration_job` at job creation. It currently includes:

- `methodId`
- `methodName`
- `methodVersion`
- `dataFields`
- `variableBindings`
- `formulas`
- `validations`
- `uncertaintyParams`
- `certificateContent`

Job creation snapshots the method only if the service-linked method is `PUBLISHED`. Historical jobs and certificates depend on this frozen legacy shape.

v2 must preserve legacy snapshot readers and add a versioned v2 snapshot/artifact discriminator for new jobs.

## Existing Integration Points

- Services link to methods through `service.methodId`; services require linked methods to be published for job creation.
- Asset type compatibility is enforced when creating jobs.
- Required `asset_spec` method fields are checked against asset specifications at job creation and execution.
- Reference standards and environmental conditions are snapshotted during execution.
- Certificate rendering uses method formulas, formula reporting metadata, certificate content, and job results.
- Public portal certificate views expose `methodSnapshot` and `results` for approved jobs.

## Initial v2 Work Items

1. Create `packages/method-definition` with:
   - Versioned method definition schema.
   - Legacy-to-v2 draft migration schema.
   - Normalization rules for variables, fields, formulas, criteria, and certificate content.
   - Compile result type with diagnostics and immutable artifact shape.
   - Preview/evaluation input and output types.

2. Add backend compile/preview/publish flow:
   - `compile`: validate a draft and return diagnostics/artifact preview without changing publish state.
   - `preview`: evaluate sample inputs against the compiled artifact server-side.
   - `publish`: persist an immutable compiled artifact and update workflow/audit state.
   - `migrate legacy`: create a v2 draft from a legacy method; never auto-publish.

3. Replace method create/edit with UI v2:
   - Existing method routes render `apps/web/src/components/method-builder-v2`.
   - Save still persists the editable draft payload.
   - Compile, preview, and publish call the backend routes.
   - Publish freezes the compiled artifact and evidence on the method record.

4. Add migration/audit evidence:
   - Record source legacy method id/version/status.
   - Record migration diagnostics and unsupported features.
   - Keep migrated drafts editable and explicitly reviewable before publish.
