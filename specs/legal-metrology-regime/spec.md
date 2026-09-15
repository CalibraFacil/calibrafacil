# Legal-metrology regime + regulated verification periodicity — Spec

> The spec is the prompt. Implementation runs against the Acceptance Criteria below;
> `spec-verifier` checks them. Authored with `ears-spec` + `calibrafacil-domain`.
> Source: design doc `.goals/legal-metrology-regime.md`, issue #423 (legal-metrology half).
> Companion to `specs/calibration-interval-customer-owned/spec.md`.
>
> **Supersedes** `REQ-ACCESS-INT-005` and `REQ-INTERVAL-030` of the customer-owned spec:
> the portal `409` legal lock is **removed** — a legal asset keeps a customer-owned
> calibration interval (the two regimes are independent; see Intent). Those IDs are
> retired here, not renumbered.

## Intent

An instrument can be in **two independent metrology regimes at once** (validated, primary
sources): the voluntary **ISO/IEC 17025 / RBC calibration** regime — whose interval is the
**customer's** (§7.8.4.3 + ILAC-G24) — and the mandatory **legal-metrology** regime
(RBMLQ-I) — whose verification periodicity is **fixed by regulation**. A regulated
instrument the lab also RBC-calibrates therefore has **two periods for two purposes**.

This spec models the asset as **two independent interval tracks**:

- **Track 1 — calibration interval (customer-owned, ALL instruments):** the existing
  `calibration_interval_months` → `next_calibration_date`, set by the customer in the
  portal, suggested by the reliability engine. Now available for legal instruments too.
- **Track 2 — legal-verification periodicity (regulation-fixed, LEGAL instruments):** a new
  structured `regulated_interval` → `next_legal_verification_date`, recorded by the lab from
  the governing Portaria, never customer-editable, never engine-touched.

"Done" = an asset carries an explicit `metrology_regime`; the customer-owned calibration
interval works for every regime (no legal lock); the reliability engine is regime-agnostic;
a LEGAL asset additionally carries a validated, shape-faithful regulated period that derives
a correctly-labelled (indicative where Ipem-operationalized) `next_legal_verification_date`
without ever touching Track 1 — all test-backed.

## Constraints

- **Schema changes are forward-only, hand-authored** (`pnpm db:generate` broken past 0006 —
  hand-add the `.sql` + `_journal.json`; next number **0066**; operator applies prod+dev).
  Never hand-edit applied SQL. **local-db / offline parity is deferred** (the customer-owned
  interval columns in 0065 were not mirrored either — see Out-of-scope).
- **`subject_to_legal_metrology` is KEPT** during this transition, derived from
  `metrology_regime` on every write (still gates the repair-seal UI + offline/sync). Dropping
  it is a later migration, out of scope.
- **Reuse the RBAC layer.** Lab regime/regulated-interval writes reuse
  `withLabPermission({ equipment: ["update"] })`; the portal calibration-interval write
  reuses `requirePortalProtected` + `decidePortalIntervalWrite`.
- **Preserve `organizationId` + `unitId` tenant scoping**; portal customer ids opaque (404,
  never 403, for out-of-tenant).
- **Regime is a LAB-authored fact** (enquadramento + finalidade de uso), never inferred from
  `assetType`.
- **The two tracks are independent:** a Track-2 (legal) write SHALL NOT modify Track-1
  (`calibration_interval_months`, `next_calibration_date`), and a Track-1 (portal) write
  SHALL NOT modify Track-2 (`regulated_interval`, `next_legal_verification_date`).
- **The engine stays pure and regime-agnostic** — it analyzes Track 1 only and SHALL NOT
  read the legal-verification track.
- **Regulatory strings verbatim** (NBR ISO/IEC 17025, Inmetro, Portaria, RBMLQ-I, ILAC-G24 /
  OIML D 10). pt-BR copy; `.portal-shell`. Portal raw `fetch` to `/api/portal/*`. UI on
  `@base-ui/react` (no Radix). No `useEffect`; no `as`. Tests `*.spec.ts`.

## Acceptance Criteria (EARS)

### Mini-spec L1 — Regime + legal-verification schema + backfill — `REQ-MLR` [pair-don't-loop]

- REQ-MLR-001: The `asset` table SHALL have a `metrology_regime` column constrained to
  `INDUSTRIAL | LEGAL | UNKNOWN` (NOT NULL, default `INDUSTRIAL`), a nullable
  `regulated_interval` jsonb column, and a nullable `next_legal_verification_date` timestamp.
- REQ-MLR-002: WHEN migration 0066 runs, the system SHALL backfill `metrology_regime =
'LEGAL'` for every row whose `subject_to_legal_metrology` is true, and `'INDUSTRIAL'`
  otherwise. [HIGH RISK]
- REQ-MLR-003: WHEN an asset's `metrology_regime` is written, the system SHALL keep
  `subject_to_legal_metrology` consistent (`true` ⟺ `metrology_regime = 'LEGAL'`). [HIGH RISK]
- REQ-MLR-004: The asset's customer-owned calibration interval (`calibration_interval_months`,
  `interval_set_by ∈ {customer_confirmed, engine_applied}`) SHALL remain available and
  unaffected by `metrology_regime` (no regime value gates or clears it). [HIGH RISK]

### Mini-spec L2 — RegulatedInterval validation (pure Zod) — `REQ-MLR`

- REQ-MLR-010: `RegulatedIntervalSchema` (`@calibra-facil/schemas`) SHALL be a discriminated
  union on `kind ∈ {fixed_months, max_months_from_install, per_technology,
not_nationally_fixed}`, each member requiring a trimmed non-empty `regulationReference` and
  a boolean `operationalizedByDelegate`.
- REQ-MLR-011: For `kind ∈ {fixed_months, max_months_from_install, per_technology}` the
  schema SHALL require `valueMonths` as an integer within `[1, 600]`; for
  `max_months_from_install` it SHALL require `anchor = 'install_year'`; for `per_technology`
  it SHALL additionally require a trimmed non-empty `technology`.
- REQ-MLR-012: IF a `regulatedInterval` payload fails `RegulatedIntervalSchema`, THEN the API
  SHALL reject with `400` and a named validation error and SHALL NOT modify any row. [HIGH RISK]

### Mini-spec L3 — Legal-verification next-date derivation (pure) — `REQ-MLR`

`deriveRegulatedNextDate(regulatedInterval, anchors)` →
`{ date, indicative, isCeiling }`; `anchors = { lastVerificationDate, firstVerificationDate, installDate }`.

- REQ-MLR-020: WHEN `kind = fixed_months` and `anchor = last_verification`, the function
  SHALL return `date = lastVerificationDate + valueMonths` (UTC, end-of-month clamped).
- REQ-MLR-021: WHEN `kind = fixed_months` and `anchor = calendar_year`, the function SHALL
  return `date =` 31 December of `year(lastVerificationDate) + 1`.
- REQ-MLR-022: WHEN `kind = max_months_from_install`, the function SHALL return
  `date = installDate + valueMonths` with `isCeiling = true`.
- REQ-MLR-023: WHEN `kind = per_technology`, the function SHALL return the configured anchor
  date (`last_verification` or `first_verification`) `+ valueMonths`.
- REQ-MLR-024: WHEN `kind = not_nationally_fixed`, the function SHALL return `date = null`.
- REQ-MLR-025: WHERE `operationalizedByDelegate = true` OR `kind = not_nationally_fixed`, the
  function SHALL return `indicative = true`.
- REQ-MLR-026: IF the anchor date required by the `kind` is absent, THEN the function SHALL
  return `date = null` and SHALL NOT fabricate a date. [HIGH RISK]

### Mini-spec L4 — Lab records the legal-verification periodicity (API) — `REQ-MLR` [pair-don't-loop]

- REQ-MLR-030: WHEN a lab member with `equipment:update` writes `metrology_regime = LEGAL`
  with a valid `regulatedInterval`, the API SHALL persist `regulated_interval`, derive and
  persist `next_legal_verification_date` via `deriveRegulatedNextDate`, and SHALL NOT modify
  `calibration_interval_months` or `next_calibration_date` (Track 1 is independent). [HIGH RISK]
- REQ-MLR-031: WHEN a lab member writes `metrology_regime ∈ {INDUSTRIAL, UNKNOWN}`, the API
  SHALL clear `regulated_interval` and `next_legal_verification_date` and SHALL NOT modify the
  customer's calibration interval. [HIGH RISK]
- REQ-MLR-032: WHEN an asset's regime or regulated interval changes, the API SHALL write an
  `asset_audit_log` row recording previous→new values and the acting user. [HIGH RISK]
- REQ-MLR-033: IF a member without `equipment:update` calls the regime / regulated-interval
  write, THEN the API SHALL reject with `403` via the lab permission guard and SHALL NOT
  modify any row. [HIGH RISK]

### Mini-spec L5 — Portal calibration interval available for all regimes — `REQ-MLR` [HIGH RISK]

- REQ-MLR-040: WHEN a portal `client_user` PUTs `/api/portal/assets/:id/interval` for an
  in-tenant asset with a valid body, the API SHALL set `calibration_interval_months` and
  recompute `next_calibration_date` **regardless of `metrology_regime`** (a legal asset is
  NOT rejected with `409`). [HIGH RISK]
- REQ-MLR-041: IF the target asset does not resolve to the caller's customer org, THEN the
  API SHALL reject with `404` (not `403`) and SHALL NOT modify any row. [HIGH RISK]
- REQ-MLR-042: WHEN the portal calibration-interval write succeeds, it SHALL NOT modify
  `regulated_interval` or `next_legal_verification_date` (the legal track is not
  customer-editable). [HIGH RISK]

### Mini-spec L6 — Engine is regime-agnostic — `REQ-MLR` [HIGH RISK]

- REQ-MLR-050: WHEN `analyzeInterval` runs, it SHALL analyze the customer-owned calibration
  interval from as-found reliability **regardless of `metrology_regime`**, and SHALL NOT
  emit a `LEGAL_FIXED` suppression for legal-metrology assets. [HIGH RISK]
- REQ-MLR-051: The reliability engine SHALL NOT read or derive the legal-verification
  periodicity (`regulated_interval` / `next_legal_verification_date`) — the two tracks are
  independent.

### Mini-spec L7 — Two-date portal view + regime selector (frontend) — `REQ-MLR`

- REQ-MLR-060: WHEN a portal user opens a `metrology_regime = LEGAL` asset, the portal SHALL
  display BOTH the customer-owned calibration schedule ("Próxima calibração") AND the
  regulated legal-verification periodicity ("Próxima verificação — metrologia legal") as
  distinct items.
- REQ-MLR-061: WHERE an asset's `regulated_interval.operationalizedByDelegate = true`, the
  portal SHALL present the legal-verification date as indicative (cadência operacionalizada
  pelo Ipem — não é prazo nacional fixo), not a hard deadline.
- REQ-MLR-062: WHEN `metrology_regime = LEGAL` with `kind = not_nationally_fixed`, the portal
  SHALL display "sem periodicidade nacional fixada" for the legal-verification track and
  SHALL NOT show a legal-verification due-date.
- REQ-MLR-063: The lab asset create/edit form SHALL render a regime selector (INDUSTRIAL /
  LEGAL / UNKNOWN) and, WHEN LEGAL is selected, the regulated-interval fields; the
  customer-interval control SHALL remain absent for every regime (the lab never authors the
  customer calibration interval).

## Out-of-scope / Deferred

- **Normalized regulation catalog** (`legal_metrology_regulation`: Portaria → default
  kind/value/body) — deferred until >1 Portaria is in play.
- **`installed_at` column** for the `install_year` anchor — added when water meters are
  onboarded; until then `max_months_from_install` returns null (REQ-MLR-026).
- **Recall notifications on `next_legal_verification_date`** — the worker recall keys on
  `next_calibration_date` today; extending it to the legal-verification date is Phase 2 (the
  date is derived + surfaced here).
- **Dropping `subject_to_legal_metrology`** + migrating the ~10 boolean read-sites — later
  forward-only migration.
- **Offline / `packages/local-db` parity** for the regime + regulated-interval columns —
  deferred, consistent with 0065 (the customer-owned interval columns were not mirrored to
  local-db either). Desktop/offline asset CRUD does not carry these columns yet.
- **Verificação após reparo / repair-seal scheduling** — already on `serviceOrder` (#588);
  untouched here.
- **Calibration certificate interval silence** (§7.8.4.3) — already guarded (B6); the
  regulated period is NOT a cert recommendation, so no cert change here.

## Decomposition

| Mini-spec                               | Layer (real path)                                                             | Depends on | Risk                                       | Mode                            |
| --------------------------------------- | ----------------------------------------------------------------------------- | ---------- | ------------------------------------------ | ------------------------------- |
| L1 regime/legal-verif schema + backfill | `packages/db/src/schema.ts` + migration 0066 + local-db mirror                | —          | **high (migration + transition)**          | **pair-don't-loop**             |
| L2 RegulatedInterval Zod                | `packages/schemas`                                                            | —          | low                                        | loopable-with-verifier          |
| L3 next-date derivation (pure)          | `apps/api/src/lib/regulated-interval.ts` (reuse `deriveNextCalibrationDate`)  | L2         | med                                        | loopable-with-verifier (oracle) |
| L4 lab regulated-interval write         | `apps/api/src/routes/assets.ts` + `CreateAsset/UpdateAsset` schema            | L1,L2,L3   | **high (regulatory + track independence)** | **pair-don't-loop**             |
| L5 portal lock removal                  | `apps/api/src/lib/portal-asset-interval.ts` + `apps/api/src/routes/portal.ts` | L1         | **high (relaxes shipped guard)**           | **pair-don't-loop**             |
| L6 engine regime-agnostic               | `packages/interval-analysis` + `apps/api/src/lib/interval-insight.ts` caller  | L1         | **high (removes LEGAL_FIXED)**             | loopable-with-verifier (oracle) |
| L7 two-date UI + regime selector        | `apps/portal` asset view + `apps/web/src/features/assets/*`                   | L4,L5      | med                                        | loopable-with-verifier          |

**Pairing note:** L1, L4, L5 touch the asset migration, the regulated write path + track
independence, and the relaxation of a shipped HIGH-RISK guard → **pair-don't-loop**
(in-session with the human + `spec-verifier`). L2, L3, L6, L7 are loopable-with-verifier.
Start with **L2** (pure Zod) and **L3** (pure derivation, oracle-verifiable), then pair on
the schema + write path + lock removal.
