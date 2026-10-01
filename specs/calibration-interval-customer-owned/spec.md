# Customer-owned calibration interval + reliability foundation — Spec

> The spec is the prompt. Implementation runs against the Acceptance Criteria
> below; `spec-verifier` checks them. Authored with `ears-spec` + `calibrafacil-domain`.
> Source: internal design notes (not published), issue #423.
> Scope of THIS spec: **Phase A (reliability data foundation)** + **Phase B (the
> compliance flip)**. Engine phases C/D/E are deferred (see Out-of-scope).

## Intent

The calibration **interval/periodicity is the equipment owner's (the customer's)
responsibility, not the lab's** — ISO/IEC 17025:2017 §7.8.4.3 bars a lab from putting
an interval recommendation on a certificate/label except where agreed with the
customer; ILAC-G24/OIML D 10:2022 frames the interval as decided by whoever controls
the equipment. Today the **lab** sets it implicitly (periodicity presets that write
`asset.nextCalibrationDate`), and the customer cannot touch it. This spec (a) lays the
**as-found reliability data foundation** the future optimization engine needs, and
(b) **flips control to the customer in the portal**: the lab stops attributing any
periodicity; the customer sets/owns the interval with a documented rationale; the
certificate stays silent. "Done" = lab can no longer author an interval, the customer
can set one through a tenant-safe portal endpoint with an audit trail, legal-metrology
assets stay locked to their regulated period, and a per-job as-found conformity verdict
is computed for future reliability analysis — all test-backed.

## Constraints

- **Greenfield — no migration.** No assets are registered yet; the lab interval-setting
  path is **removed outright** (no legacy flags, no backfill, no dual-state UI).
- **Reuse the RBAC layer, never inline rules.** The portal endpoint reuses
  `requirePortalProtected` + the portal customer-scope resolution
  (`asset.customerId → customer.authOrganizationId === session org`, the existing
  `portal.ts` scoping pattern). Lab asset routes keep
  `withLabPermission({ equipment: [...] })` (`apps/api/src/middleware/permission.ts`).
- **Preserve `organizationId` + `unitId` tenant scoping.** Never read/write a row
  outside the caller's scope; portal customer ids stay opaque.
- **Schema changes are forward-only, hand-authored** (`pnpm db:generate` is broken past
  0006 — add the `.sql` + `_journal.json` entry by hand; operator applies prod+dev).
  Never hand-edit applied SQL.
- **As-found is the reliability signal; as-left must never substitute for it.** Use the
  pre-adjustment margin key `margem_conformidade_antes`; the certificate verdict's
  `margem_conformidade_apos` (as-left) is for conformity, NOT reliability.
- **No interval recommendation on certificates/labels** (§7.8.4.3) — enforce with a guard test.
- **Regulatory strings verbatim** (NBR ISO/IEC 17025, Inmetro, ILAC-G24 / OIML D 10).
- pt-BR portal copy; `.portal-shell`. Portal uses raw `fetch` to `/api/portal/*`
  (no `@calibra-facil/client-runtime`, never `@calibra-facil/api`). UI on
  `@base-ui/react` (no Radix). No `useEffect` import; no `as` assertions. Tests `*.spec.ts`.

## Acceptance Criteria (EARS)

### Mini-spec A1 — As-found reliability verdict (pure) — `REQ-RELIA`

A pure module (mirror `apps/api/src/lib/portal-certificate-verdict.ts`) that derives a
per-job **as-found** conformity verdict from frozen `results`. The metrology rule
(as-found only; never as-left) is regulated — `[HIGH RISK]` and confirmed by a human.

- REQ-RELIA-001: WHEN building the as-found verdict from a job's `results`, the system
  SHALL read the as-found conformity margins exclusively from `margem_conformidade_antes`. [HIGH RISK]
- REQ-RELIA-002: WHEN at least one as-found margin exists and every as-found margin is
  ≥ 0, the system SHALL report `asFoundConformity = "CONFORMING"`.
- REQ-RELIA-003: WHEN at least one as-found margin is < 0, the system SHALL report
  `asFoundConformity = "NON_CONFORMING"`.
- REQ-RELIA-004: IF no as-found margins exist (`margem_conformidade_antes` absent or
  empty), THEN the system SHALL report `asFoundConformity = "UNKNOWN"` and SHALL NOT
  substitute post-adjustment (`margem_conformidade_apos`) margins. [HIGH RISK]
- REQ-RELIA-005: The system SHALL parse margin values tolerating comma decimals and
  flattening nested point arrays (same numeric parsing as `portal-certificate-verdict.ts`).
- REQ-RELIA-006: The verdict result SHALL include `pointsTotal` (count of as-found
  margins) and `pointsWithin` (count ≥ 0).

### Mini-spec A2 — Persist the verdict on the job — `REQ-RELIA` (schema + wiring)

- REQ-RELIA-010: The `calibration_job` table SHALL have an `as_found_conformity` column
  constrained to `CONFORMING | NON_CONFORMING | UNKNOWN` and an `as_found_margins` jsonb column.
- REQ-RELIA-011: WHEN a calibration job transitions to approved, the system SHALL compute
  and persist `as_found_conformity` from its frozen `results` via the A1 module. [HIGH RISK]
- REQ-RELIA-012: The verdict-persistence wiring SHALL NOT change any calibration-approval
  permission, state transition, or approver column (separation-of-duties untouched). [HIGH RISK]

### Mini-spec B1 — Asset interval columns (schema) — `REQ-INTERVAL`

- REQ-INTERVAL-001: The `asset` table SHALL have a nullable `calibration_interval_months`
  integer, an `interval_set_by` column constrained to
  `customer_confirmed | engine_applied | legal_fixed`, `interval_set_at` timestamp,
  `interval_set_by_user_id`, and `interval_rationale` text.
- REQ-INTERVAL-002: WHILE `calibration_interval_months` is null, the asset's derived
  calibration status SHALL be "unscheduled" (aguardando definição do cliente).
- REQ-INTERVAL-003: WHEN `calibration_interval_months` and `last_calibration_date` are
  both set, the system SHALL derive `next_calibration_date` = `last_calibration_date`
  plus that many months.

### Mini-spec B2 — Portal interval write endpoint — `REQ-ACCESS-INT` [pair-don't-loop]

`PUT /api/portal/assets/:id/interval`. New authorization boundary — every criterion
binds the real portal scope; tenant isolation tested.

- REQ-ACCESS-INT-001: WHEN an authenticated portal user PUTs the endpoint for an asset
  whose `customerId` resolves to the caller's `authOrganizationId` with a valid body,
  the API SHALL set `calibration_interval_months`, `interval_set_by='customer_confirmed'`,
  `interval_set_by_user_id`, `interval_set_at`, recompute `next_calibration_date`, and
  return `200`.
- REQ-ACCESS-INT-002: IF the target asset does not resolve to the caller's customer org,
  THEN the API SHALL reject with `404` and SHALL NOT modify any row. [HIGH RISK]
- REQ-ACCESS-INT-003: IF the request body has no non-empty `rationale`, THEN the API
  SHALL reject with `400` and SHALL NOT modify any row. [HIGH RISK]
- REQ-ACCESS-INT-004: WHEN the interval is changed, the API SHALL write an
  `asset_audit_log` row recording previous→new interval, the acting user, and the
  rationale. [HIGH RISK]
- REQ-ACCESS-INT-005: IF the asset's `subject_to_legal_metrology` is true, THEN the API
  SHALL reject the customer interval change with `409` and SHALL NOT modify the
  interval. [HIGH RISK]
- REQ-ACCESS-INT-006: IF an unauthenticated request (no portal session) calls the
  endpoint, THEN the API SHALL reject with `401` via `requirePortalProtected`. [HIGH RISK]

### Mini-spec B3 — Interval payload validation — `REQ-INTERVAL`

- REQ-INTERVAL-010: The `SetCalibrationIntervalSchema` (`@calibra-facil/schemas`) SHALL
  require `intervalMonths` as an integer within `[1, 120]` and reject values outside it
  with a parse error.
- REQ-INTERVAL-011: The `SetCalibrationIntervalSchema` SHALL require `rationale` as a
  trimmed non-empty string.

### Mini-spec B4 — Lab demotion (stop attributing periodicity) — `REQ-INTERVAL`

- REQ-INTERVAL-020: The lab asset create and edit forms SHALL NOT render a calibration
  periodicity preset control nor a next-calibration-date authoring control.
- REQ-INTERVAL-021: WHEN the lab POSTs or PUTs `/api/assets` with a `nextCalibrationDate`
  or interval field, the API SHALL ignore it and SHALL NOT persist a lab-authored
  interval or next-calibration-date. [HIGH RISK]
- REQ-INTERVAL-022: The lab asset detail UI SHALL render the customer-owned interval
  read-only, showing "definido pelo cliente" or "aguardando definição do cliente".

### Mini-spec B5 — Legal-metrology lock — `REQ-INTERVAL` [HIGH RISK]

- REQ-INTERVAL-030: WHERE an asset is `subject_to_legal_metrology`, the portal interval
  editor SHALL render the interval as fixed-by-regulation and SHALL NOT offer an editable
  control. [HIGH RISK]

### Mini-spec B6 — Certificate/label guard — `REQ-COMPLIANCE` [HIGH RISK]

- REQ-COMPLIANCE-001: The calibration certificate and calibration label templates SHALL
  NOT render any calibration-interval recommendation. [HIGH RISK]

### Mini-spec B7 — Portal interval editor UI — `REQ-INTERVAL` (frontend)

- REQ-INTERVAL-040: WHEN a portal user opens an asset whose interval is null, the UI
  SHALL display "aguardando definição do cliente" and an interval editor.
- REQ-INTERVAL-041: IF a portal user submits the interval editor without a rationale,
  THEN the UI SHALL block submission and SHALL NOT call the endpoint.

## Out-of-scope / Deferred

- **Phase C — Insight engine** (`packages/interval-analysis`: ILAC-G24 M1 staircase +
  M2 control-chart + stable/drifting/insufficient classification) — its own spec; gated
  by a numeric oracle. Reads the A1/A2 verdict + history.
- **Phase D — Recommendation + one-click apply** (`engine_applied` write path).
- **Phase E — Family reliability (NCSL RP-1 / M5) + confidence + optimization-report PDF.**
- **Single-phase "calibration without adjustment" jobs that store margins only under
  `_apos`:** OPEN metrology question — REQ-RELIA-004 conservatively returns UNKNOWN for
  these. A human must confirm whether a no-adjustment single-phase reading should count
  as as-found before broadening it. Until then: UNKNOWN (excluded from reliability).
- **Built-in templates emitting a standard `margem_conformidade_antes`:** the built-in
  method templates do NOT emit conformity-margin keys today (0 hits), so A1 yields UNKNOWN
  for them. Standardizing a conformity key in templates is a follow-up (feeds engine coverage).
- **Non-portal customers / delegation agreement** (§7.8.4.3 "agreed with the customer"
  escape hatch for customers who never log in) — deferred; default is interval-less + a lab prompt.
- **Billing/tier gating** (PRO/ENT) — decide before Phase D.

## Decomposition

| Mini-spec                    | Layer (real path)                                                                                     | Depends on | Risk                            | Mode                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- | ---------- | ------------------------------- | ----------------------------------------- |
| A1 as-found verdict (pure)   | `apps/api/src/lib/as-found-reliability-verdict.ts` (mirror `portal-certificate-verdict.ts`)           | —          | med (metrology rule)            | loopable-with-verifier (oracle)           |
| A2 persist verdict on job    | `packages/db` schema + approval wiring (`apps/api/src/routes/jobs.ts`)                                | A1         | **high (approval-adjacent)**    | **pair-don't-loop**                       |
| B1 asset interval columns    | `packages/db/src/schema.ts` + hand migration                                                          | —          | med                             | pair-don't-loop (migration review)        |
| B2 portal write endpoint     | `apps/api/src/routes/portal.ts` + portal scope                                                        | B1, B3     | **high + critical (new authz)** | **pair-don't-loop**                       |
| B3 interval payload Zod      | `packages/schemas`                                                                                    | —          | low                             | loopable-with-verifier                    |
| B4 lab demotion              | `apps/web/src/features/assets/*` + `apps/api/src/routes/assets.ts` + `CreateAsset/UpdateAsset` schema | B1         | **high (compliance flip)**      | **pair-don't-loop** (API contract change) |
| B5 legal-metrology lock      | `apps/portal` editor + B2 endpoint (REQ-ACCESS-INT-005)                                               | B2         | **high (regulatory)**           | **pair-don't-loop**                       |
| B6 certificate guard test    | `packages/documents`, `packages/label-rendering` tests                                                | —          | high (regulatory)               | loopable-with-verifier (guard test)       |
| B7 portal interval editor UI | `apps/portal/src/features/fleet` (Base UI / Watermelon-derived)                                       | B2, B3     | low                             | loopable-with-verifier                    |

**Pairing note:** A2, B1, B2, B4, B5 touch the approval flow, the asset migration, a new
RBAC boundary, or the compliance flip → **pair-don't-loop** (implement in-session with the
human + `spec-verifier`, not an unattended worktree loop). A1, B3, B6, B7 are
loopable-with-verifier. Start with **A1** (pure, fully verifiable, unblocks the engine and
the OOT epic) and **B3** (pure Zod), then pair on the schema + endpoint.
