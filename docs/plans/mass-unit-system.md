# Mass Unit System for Assets and Calibrations

## Decision

This is a cross-cutting refactor, not a safe isolated patch.

The current system does not have a first-class, immutable mass unit on the
asset model. Mass-related values are also persisted across assets, job
execution, method definitions, standards, and certificate rendering in shapes
that do not currently preserve a single authoritative asset unit.

Because of that, full enforcement of the invariant below requires schema,
backend, frontend, snapshot, and certificate changes.

## Required Invariant

For mass-based instruments such as scales and balances:

- Each asset must have a base mass unit selected at registration.
- Supported units: `kg`, `g`, `mg`.
- This unit becomes the authoritative unit for the asset lifecycle.
- The asset unit cannot be edited after creation without an explicit migration
  flow.

## Current Gaps

### Asset registration

- Assets do not store any base measurement unit.
- Asset create/update schemas accept generic `specifications` with no unit
  policy.
- Balance-like asset type seeds hardcode mass fields in `g`, which biases new
  assets toward a fixed unit even when the instrument should be managed in
  `kg` or `mg`.

### Calibration methods and execution

- Method inputs and formulas use free-form `unit?: string` metadata.
- Job execution stores worksheet `data` as untyped JSON and `results` as plain
  JSON values.
- The backend does not normalize or validate mass values against an asset unit
  before persisting them.

### Reference standards

- Standards can already carry their own units, especially in
  `certifiedValues`, which is good for traceability.
- Conversion currently happens only in isolated frontend helpers for specific
  widgets, not as a guaranteed backend rule.

### Certificates

- Certificate rendering consumes persisted snapshots and result payloads.
- Since job snapshots do not currently include an asset mass unit, the
  renderer has no authoritative source to enforce a single display unit when
  data was entered or stored inconsistently.

### Auditability

- Audit logs track changed payloads, but there is no dedicated conversion log
  describing input unit, normalized value, output unit, and conversion reason.

## Target Design

### 1. Asset becomes the unit authority

Add immutable asset-level fields for mass-capable instruments:

- `measurementDiscipline`: `mass | other`
- `baseMeasurementUnit`: `kg | g | mg | null`

Rules:

- `baseMeasurementUnit` is required for mass-based asset types.
- `baseMeasurementUnit` is null for non-mass instruments.
- `baseMeasurementUnit` is immutable after creation.
- Any later change must go through an explicit migration workflow that
  re-normalizes asset specs, open jobs, and future displays.

### 2. Canonical internal representation

Use one canonical internal unit for all mass calculations and persistence of
normalized mass values.

Recommended pragmatic choice for this codebase: `g`.

Reason:

- Existing conversion helpers already pivot through grams.
- Existing balance seeds and method definitions are heavily `g`-oriented.
- Using `kg` as canonical SI base would be valid metrologically, but it would
  force a larger rewrite of seeded methods and persisted expectations without
  materially improving correctness inside the application.

Policy:

- Persist user-facing mass values in the asset unit when they are pure display
  metadata that must remain human-readable.
- Persist normalized calculation payloads in canonical grams whenever those
  values enter the execution/calculation pipeline.
- Include explicit metadata describing original unit and normalized unit.

### 3. Structured mass fields, not free-form strings

For mass-aware method fields and formula outputs, extend metadata so the system
knows whether a field is:

- `mass` and must follow asset unit display rules
- `mass_display_only`
- `mass_normalized`
- `generic`

Suggested additions:

- `measurementKind?: "mass"`
- `displayUnitSource?: "asset"`
- `normalizedUnit?: "g"`

This avoids treating every `unit: "g"` string in the method builder as a
literal hardcoded unit.

### 4. Job snapshot must freeze unit context

Extend `AssetSnapshot` with:

- `baseMeasurementUnit`
- `measurementDiscipline`

Extend job execution payloads with a unit trace section for mass fields:

- original input value
- original input unit
- normalized value
- normalized unit
- conversion source, for example `manual_input`, `standard_certificate`,
  `asset_spec`, or `auto_resolved_range`

This preserves reproducibility and auditability.

### 5. Standards remain independently registered

Reference standards may keep their own units.

Rules:

- Standard registry stores the original unit from the certificate.
- Calculation pipeline converts standard values to canonical grams before use.
- UI and certificate output convert the final displayed value to the asset
  base unit.
- The original standard certificate unit remains visible where traceability is
  relevant.

### 6. Certificate output uses one asset unit

For mass-based jobs:

- All result tables, labels, formula outputs, and displayed measurement values
  use the asset base unit.
- Traceability sections may still show the original standard unit as secondary
  metadata, but the main certificate values must remain in a single unit.

## Enforcement Points

### Asset registration and metadata

- Require base mass unit on creation for mass-based asset types.
- Show the selected unit prominently in the asset UI.
- Prevent edits after creation.

### Calibration methods

- For mass-capable methods, mark relevant fields as asset-unit-driven rather
  than hardcoding `g`.
- Weighing-range specs may still contain per-range units, but the asset form
  must keep them explicit and unambiguous.

### Job execution

- UI accepts values in the active asset unit by default.
- If a controlled alternate unit input is allowed, conversion must happen
  immediately and transparently.
- Backend must normalize before saving `calibration_job.data` and
  `calibration_job.results`.

### Uncertainty and formulas

- Math engine receives canonical normalized mass values only.
- Formula labels and certificate output convert back to the asset base unit at
  the presentation boundary.

### Standards

- Convert standard values at calculation time on the backend.
- Preserve original unit in standard snapshots.

### Certificates

- Use the frozen asset base unit from `assetSnapshot`.
- Reject certificate generation for mass-based jobs if the snapshot lacks the
  unit context after rollout.

## Migration Strategy

### Phase 1: Foundation

- Add asset mass-unit fields and immutability.
- Add shared mass-unit utilities in a shared package used by API, web, worker,
  and documents.
- Update asset forms and asset snapshotting.

### Phase 2: Execution safety

- Normalize mass-aware job inputs/results before persistence.
- Add conversion audit records.
- Update method metadata to distinguish asset-unit-driven mass fields.

### Phase 3: Standards and certificates

- Convert standards in backend job execution and certificate preparation.
- Render all mass certificate values in the asset base unit.

### Phase 4: Historical backfill

- Backfill existing mass assets with an explicit `baseMeasurementUnit`.
- For existing balance assets, infer from current specifications when safe.
- Flag ambiguous assets for manual review.

## Minimum Safe Workaround

If the full refactor is deferred, apply this interim policy:

- Add immutable `baseMeasurementUnit` only to mass assets.
- Restrict mass asset registration and edit screens to show a single active
  unit.
- Keep balance asset specs and job UI locked to the asset unit.
- Convert reference-standard values in the job execution UI before they are
  copied into fields.
- Add conversion notes to job audit logs when standards or alternate unit
  inputs are converted.
- Render certificates in the asset unit only when the job carries an explicit
  asset unit snapshot; otherwise block generation for newly created mass jobs.

This workaround improves consistency for new records, but it is not equivalent
to full lifecycle enforcement because backend persistence and historical data
remain mixed.

## Recommendation

Do not present this as fully supported until Phase 2 is complete.

Phase 1 plus the workaround is a reasonable short-term release if the business
need is to stop new ambiguity quickly. Full metrological enforcement requires
the backend normalization and snapshot changes described above.
