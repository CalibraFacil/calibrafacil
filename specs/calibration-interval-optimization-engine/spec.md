# Calibration-interval optimization engine (Phases C/D/E) — Spec

> The spec is the prompt. Implementation runs against the Acceptance Criteria below;
> `spec-verifier` checks them. Authored with `ears-spec` + `calibrafacil-domain`, and
> revised after an independent oracle-math + EARS verification pass (see "Verification
> notes" at the end). Source: design doc `.goals/calibration-interval-customer-owned.md`,
> issue **#423**. Builds on the **Phase A+B** spec
> (`specs/calibration-interval-customer-owned.md`, PR #597): the as-found verdict +
> customer-owned interval already exist. Scope: **Phase C (insight)**, **Phase D
> (recommendation + apply)**, **Phase E (family reliability + report)**.

## Intent

Turn the accumulated **as-found reliability history** into an _interval suggestion_ the
**customer** can accept in the portal — never an auto-applied lab decision. A pure,
offline-parity engine computes, per instrument (and per family), a stability
classification + a `extend / keep / shorten` recommendation following **ILAC-G24 /
OIML D 10:2022** (Method 1 reactive, Method 2 control-chart) and **NCSL RP-1** (Method 5
reliability). "Done" = the customer sees a trend + classification (Phase C), can apply a
bounded, justified suggestion that writes `interval_set_by='engine_applied'` (Phase D),
and — when single-unit history is thin — the recommendation borrows strength across a
family with an explicit confidence bound (Phase E). The lab still never attributes
periodicity; the certificate still stays silent.

## Regulatory + computational basis (verified; cite, don't paraphrase)

- **ILAC-G24/OIML D 10:2022 is deliberately non-prescriptive** — decision logic for M1
  (§6.2) and M2 (§6.3); all Method-5 math deferred to NCSL RP-1 (§6.6). Every numeric
  threshold below is an **implementation choice** that MUST be **configurable and recorded
  with each recommendation** (auditors accept justified criteria, reject magic numbers).
- **M1 reactive (§6.2):** in-band → extend/hold, else shorten. Band = "within a percentage
  of the MPE range" (2007: 80%; 2022 dropped it → `p=0.80` default). **Graded M1 needs raw
  MPE → deferred** (not stored; see Data reality).
- **M2 control-chart (§6.3):** drift (regression slope) + dispersion → time until the
  projected value (with a `k·s` guard band) crosses the tolerance limit. **Standardized
  hard rule:** unsuitable for **non-drifting** instruments → refuse M2 when the slope is
  not statistically distinguishable from 0.
- **M5 (RP-1, §6.6):** observed reliability `R = in-tolerance-as-found / total`; target
  `R*` (85–95% typical; **ASQR-01 ≥95%**); exponential `R(t)=e^(−λt)`,
  `λ₀=−(1/T)·ln(S/N)`, `i₀=−ln(R*)/λ₀`; **Clopper–Pearson** (exact binomial) CI gates
  changes so small N does not whipsaw. **RP-1 is paywalled** — cite RP-1 as conformance
  basis, the open RP-1-lineage papers (Jackson–Castrup 1987; Bare 2006; PTB 2020) as the
  computational basis.
- **§7.8.4.3 / legal metrology unchanged:** suggestions live in the portal, never the
  certificate; `subjectToLegalMetrology` assets are **excluded** from the engine and from
  family pooling.

## Data reality (from codebase investigation — this SHAPES the spec)

| Fact                                                                                                                                                                                     | Consequence                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `calibration_job.asFoundConformity` + `asFoundMargins` are **write-only today** (no query projects them).                                                                                | Phase C needs a **new read query** (C0).                                                                                                                                                                                                                                                                                         |
| **Raw per-point MPE is NOT stored** — only the _signed margin_ (`margin = limit − \|error\|`, in the point's physical unit; `margin ≥ 0` ⇔ in tolerance; `margin = 0` **is** the limit). | The **graded M1 multiplier** (OOT severity in MPE-multiples) is **NOT computable** → deferred. M5 reliability (binary in/out) and **per-point** M2 margin-drift toward 0 **are** computable. Margins are NOT normalized across points (no MPE to divide by) → M2 regresses **per matched point**, never a cross-point aggregate. |
| Built-in templates emit no conformity keys → most history is `UNKNOWN`.                                                                                                                  | `UNKNOWN` jobs are **excluded from both numerator and denominator** of R, and from the drift series — never counted as a failure (that would infer failure from absent data). A separate **coverage** signal reports the KNOWN fraction.                                                                                         |
| Family discriminators (`assetTypeId`, `model`, `manufacturer`, `serialNumber`) exist.                                                                                                    | Family key = `assetTypeId + model`; single-unit key = `serialNumber`.                                                                                                                                                                                                                                                            |
| `intervalSetBy` enum has `engine_applied`; portal `PUT …/interval` **hardcodes `customer_confirmed`**.                                                                                   | Phase D adds an `engine_applied` apply path with provenance + bounds.                                                                                                                                                                                                                                                            |
| `packages/interval-analysis` does not exist; `local-db` lacks the as-found / interval columns; verdict logic lives in `apps/api`.                                                        | New pure pkg; offline parity is a deferred sub-spec.                                                                                                                                                                                                                                                                             |

## Definitions (bind every criterion to these — units are explicit)

- **Cycle:** one `APPROVED` calibration job for the asset, ordered by `approvedAt`. Two
  approvals of the same asset on the same UTC day collapse to the latest (no zero-Δt rows).
- **KNOWN cycle:** a cycle whose `asFoundConformity ∈ {CONFORMING, NON_CONFORMING}`.
  `UNKNOWN` cycles are excluded from R and from drift (counted only by **coverage**).
- **Coverage:** `KNOWN cycles / total cycles` for the asset (or family).
- **R (observed reliability):** `x / n` where `n` = KNOWN cycles, `x` = `CONFORMING` KNOWN cycles.
- **T (mean time-since-cal), in MONTHS:** the mean elapsed time the instruments ran before
  the as-found observation — the mean of the per-cycle intervals (`approvedAt[i] −
approvedAt[i−1]`, in months). All of `λ`, `i₀`, the projected `T_drift`, and the output
  interval are in **months** and clamped against `[minMonths, maxMonths]`.
- **Per-point margin series:** for a fixed measurement-point identity across cycles, the
  sequence `(t_i, margin_i)` in that point's unit. Drift is regressed **per point**.
- **m̄ (current margin) for a point:** the regression-fitted margin at the latest cycle time.
- **Confidence tails:** `confidence = 0.90` ⇒ Clopper–Pearson/binomial use two **one-sided
  0.05** tails; the M2 slope test uses a **two-sided** 90% CI; REC-001's reliability test
  uses the **one-sided** bound on the relevant side.
- **Known limitation (documented, not a defect):** margins fold on `|error|`, so a
  sign-reversing/oscillating instrument with ~constant `|error|` is NOT flagged drifting by
  M2. The engine detects monotonic drift toward the limit, not oscillation.

## Acceptance Criteria (EARS)

> Engine math is **pure + deterministic** (no wall-clock; TZ-independent), gated by a
> numeric **oracle**. Every threshold is a configurable input **recorded with the result**.
> `[HIGH RISK]` = regulatory / tenant read / writes an interval / pair-don't-loop.

### Mini-spec C0 — Reliability history read (API) — `REQ-ENGINE-DATA`

- REQ-ENGINE-DATA-001: WHEN the engine requests an asset's reliability history, the API
  SHALL return that asset's `APPROVED` jobs projecting `asFoundConformity`, `asFoundMargins`,
  and `approvedAt`, ordered by `approvedAt` ascending.
- REQ-ENGINE-DATA-002: IF the history request resolves to an asset outside the caller's
  `organizationId` (+ unit) scope, THEN the API SHALL return no rows for it. [HIGH RISK]
- REQ-ENGINE-DATA-003: WHEN the family variant is requested, the API SHALL return the same
  projection for all `assetTypeId`+`model` assets within the caller's tenant that are NOT
  `subjectToLegalMetrology`. [HIGH RISK]

### Mini-spec C1 — Pure engine: reliability + drift + classification — `REQ-ENGINE`

`packages/interval-analysis` (pure, no DB/network). Input: a dated cycle series +
config (`targetReliability` R\*, `confidence`, `minKnownCycles`, `minCoverage`, `k`,
`minMonths`, `maxMonths`). Output: classification, R, coverage, drift, recommendation, and
the **config snapshot + engine version** used.

- REQ-ENGINE-001: IF fewer than `minKnownCycles` (default 3) KNOWN cycles exist OR coverage
  `< minCoverage` (default 0.6), THEN the engine SHALL classify `INSUFFICIENT_DATA`. [HIGH RISK]
- REQ-ENGINE-002: The engine SHALL exclude `UNKNOWN`-verdict cycles from both the numerator
  and denominator of R and from the drift series. [HIGH RISK]
- REQ-ENGINE-003: WHEN computing reliability over `n` KNOWN cycles with `x` `CONFORMING`,
  the engine SHALL report `R = x/n` and `coverage = n / total cycles`.
- REQ-ENGINE-004 (M5 oracle, verified): WHEN `N=15`, `S=13`, mean-time-since-cal `T=4.13333`
  months and `R*=0.85`, the engine SHALL report `λ₀ = 0.034621` (±0.00005 /month) and
  `i₀ = 4.694` (±0.01) months.
- REQ-ENGINE-004b (M5 CI, delta-method): WHEN computing the confidence interval on `i₀`, the
  engine SHALL use the log-normal delta method `SE(ln i₀) = √[(1−R)/(N·R·(ln R)²)]` and, for
  the REQ-ENGINE-004 inputs at 90%, SHALL report `[1.47, 15.04]` months (±0.05). _(The
  Jackson–Castrup [3.48, 6.34] figure was not independently reproducible — do not use it.)_
- REQ-ENGINE-005 (M2 per-point drift): WHEN regressing a matched point's margin series
  against `approvedAt` (months), the engine SHALL report the slope `b` (margin/month) and the
  residual dispersion `s = √(Σresidual² / (n−2))`.
- REQ-ENGINE-006 (no-drift guard, standardized): IF no point's slope CI (two-sided, at
  `confidence`) excludes 0, THEN the engine SHALL classify `STABLE`. [HIGH RISK]
- REQ-ENGINE-007 (M2 projection): WHILE at least one point's slope is significant and
  negative, the engine SHALL classify `DRIFTING` and report the projected time-to-limit
  `T_drift = min over drifting points of (m̄ − k·s) / |b|` (`k=2` ≈95% default).
- REQ-ENGINE-008: IF `m̄ − k·s ≤ 0` for any drifting point (already inside the guard band),
  THEN the engine SHALL report `T_drift = 0` (overdue per drift).
- REQ-ENGINE-009: The engine SHALL clamp every recommended interval to `[minMonths, maxMonths]`.
- REQ-ENGINE-010 (R edge cases): IF `R = 1` (no recorded failures), THEN `λ₀` is taken as 0
  and the M5 interval SHALL be `maxMonths`; IF `R = 0`, THEN the M5 interval SHALL be `minMonths`.
- REQ-ENGINE-011 (provenance): The engine output SHALL include the config snapshot
  (`R*`, `confidence`, `k`, `minKnownCycles`, `minCoverage`, bounds) and an engine
  version + input fingerprint (mirroring `packages/math-engine`'s ENGINE_VERSION + SHA-256). [HIGH RISK]

### Mini-spec C2 — Portal insight (read-only) — `REQ-ENGINE-INSIGHT`

- REQ-ENGINE-INSIGHT-001: WHEN a portal user opens an asset in their tenant,
  `GET /api/portal/assets/:id/interval-insight` SHALL return the classification, `R`,
  coverage, and the dated margin series. [HIGH RISK]
- REQ-ENGINE-INSIGHT-002: IF the asset is `subjectToLegalMetrology`, THEN the endpoint SHALL
  return classification `legal_fixed` and SHALL NOT compute an optimization suggestion. [HIGH RISK]
- REQ-ENGINE-INSIGHT-003: The portal asset detail SHALL NOT write any interval from the
  insight surface (insight only). [HIGH RISK]
- REQ-ENGINE-INSIGHT-004: The portal asset detail SHALL render the margin trend + the
  stability pill + the coverage fraction.

### Mini-spec D1 — Recommendation — `REQ-ENGINE-REC`

- REQ-ENGINE-REC-001: WHEN the reliability one-sided lower bound exceeds `R*`, the engine
  SHALL recommend `extend`.
- REQ-ENGINE-REC-002: WHEN the reliability one-sided upper bound is below `R*`, the engine
  SHALL recommend `shorten`.
- REQ-ENGINE-REC-003: IF the reliability CI straddles `R*`, THEN the engine SHALL recommend
  `keep` (the whipsaw guard).
- REQ-ENGINE-REC-004 (M2↔M5 arbitration): IF the classification is `DRIFTING`, THEN the
  engine SHALL NOT recommend `extend` regardless of `R` (a detected drift overrides a
  reliability-based extend). [HIGH RISK]
- REQ-ENGINE-REC-005: The recommendation SHALL report the proposed interval (months, integer,
  rounded **down**), the method (`M2_drift | M5_reliability | M5_family`), and the bound used.
- REQ-ENGINE-REC-006: IF the asset is `subjectToLegalMetrology`, THEN the engine SHALL
  recommend nothing. [HIGH RISK]

### Mini-spec D2 — Apply a suggestion (portal write) — `REQ-ENGINE-APPLY` [pair-don't-loop]

Extends the existing `PUT /api/portal/assets/:id/interval`.

- REQ-ENGINE-APPLY-001: WHEN a portal user applies a suggestion with `source='engine'` and a
  rationale, the API SHALL set the interval, `interval_set_by='engine_applied'`, the user,
  timestamp, rationale, recompute `next_calibration_date`, and write an audit row. [HIGH RISK]
- REQ-ENGINE-APPLY-002: IF the applied interval is outside `[minMonths, maxMonths]`, THEN the
  API SHALL reject with `400` and SHALL NOT modify the asset. [HIGH RISK]
- REQ-ENGINE-APPLY-003: The apply path SHALL reuse the existing tenant-scope (404),
  legal-metrology (409), and rationale (400) guards unchanged (REQ-ACCESS-INT-002/-003/-005). [HIGH RISK]
- REQ-ENGINE-APPLY-004: No worker, cron, or queue code path SHALL call the interval-write
  (only the customer-initiated apply route writes an interval). [HIGH RISK]

### Mini-spec E1 — Family reliability (RP-1) — `REQ-ENGINE-FAMILY`

- REQ-ENGINE-FAMILY-001: WHEN single-unit KNOWN cycles `< minKnownCycles` but the family
  (`assetTypeId`+`model`, excluding legal-metrology units) has `≥ minFamilyN` (default 8)
  KNOWN cycles, the engine SHALL compute the recommendation from the family and label the
  method `M5_family`.
- REQ-ENGINE-FAMILY-002: The engine SHALL compute the family reliability CI with the
  **Clopper–Pearson** exact-binomial method at `confidence`.
- REQ-ENGINE-FAMILY-003 (oracle, verified): WHEN `n=20`, `x=18`, `confidence=0.90`, the
  engine SHALL report `R̂ = 0.900` with a Clopper–Pearson CI of `[0.717, 0.982]` (±0.002),
  where `R_L = BetaInv(0.05; 18, 3)` and `R_U = BetaInv(0.95; 19, 2)`.
- REQ-ENGINE-FAMILY-004: The family interval SHALL derive from the family `λ₀` (family `T` =
  mean per-unit time-since-cal) via `i₀ = −ln(R*)/λ₀`, then clamp to `[minMonths, maxMonths]`.

### Mini-spec E2 — Optimization report PDF — `REQ-ENGINE-REPORT`

- REQ-ENGINE-REPORT-001: WHEN a customer requests an optimization report, the system SHALL
  render a PDF (reusing `packages/documents`) showing the classification, reliability +
  confidence, proposed vs current interval, coverage, and the cited method.
- REQ-ENGINE-REPORT-002: The optimization-report PDF SHALL NOT be rendered through the
  calibration-certificate path and SHALL NOT carry certificate identity (no §7.8.4.3 surface). [HIGH RISK]

## Out-of-scope / Deferred

- **Graded M1 multiplier (Bare reactive scheme):** needs per-point **raw MPE** (not stored).
  Requires a "capture per-point MPE at execution" data step first. Until then the engine uses
  M5/M2 only; the insight UI notes the gap. The `p=0.80` config is reserved for it (no EARS yet).
- **Offline/desktop parity:** extract the as-found verdict into a shared pure package + add
  `as_found_*` and `calibration_interval_*` columns to `local-db`. Own sub-spec. Insight
  cannot render offline until then.
- **Worker batch recompute:** a new `AppQueueJobType` + handler to precompute insights when
  approvals land (perf only; the read-path computes on demand first).
- **Sign-reversing/oscillation detection** (the `|error|`-folding limitation) — needs signed
  per-point error capture, not just the folded margin.
- **Billing/tier gating** (PRO/ENT) — product decision before D ships.

## Decomposition

| Mini-spec                 | Layer (real path)                              | Depends on       | Risk                       | Mode                            |
| ------------------------- | ---------------------------------------------- | ---------------- | -------------------------- | ------------------------------- |
| C0 history read           | `apps/api/src/routes/portal.ts` + tenant scope | A (verdict cols) | high (tenant)              | pair-don't-loop                 |
| C1 pure engine            | `packages/interval-analysis` (new)             | —                | med (metrology math)       | loopable-with-verifier (oracle) |
| C2 portal insight         | `apps/api` GET + `apps/portal` `$id.tsx`       | C0, C1           | med                        | loopable-with-verifier          |
| D1 recommendation         | `packages/interval-analysis`                   | C1               | med                        | loopable-with-verifier (oracle) |
| D2 apply (engine_applied) | `apps/api/src/routes/portal.ts` (extend PUT)   | B2, D1           | **high (writes interval)** | **pair-don't-loop**             |
| E1 family RP-1            | `packages/interval-analysis`                   | C1               | med (binomial CI)          | loopable-with-verifier (oracle) |
| E2 report PDF             | `packages/documents`                           | D1               | low                        | loopable-with-verifier          |

**Pairing:** C0 (tenant read) + D2 (writes an interval) → pair-don't-loop. The pure engine
(C1/D1/E1) is loopable **only** while gated by the numeric oracle + the no-drift /
legal-metrology / never-auto-apply / UNKNOWN-exclusion HIGH-RISK guards. Start with **C1**
(pure, oracle-testable) and **C0** (the read it needs), then C2 → D1 → D2 → E1 → E2.

## Verification notes (from the independent oracle/EARS pass)

- **Sources verified current (web-checked 2026-06-26):** ILAC-G24 / OIML D 10 **:2022** (latest;
  approved Dec 2022), NCSL RP-1 **:2010** (latest; **paywalled** → computational basis is the
  open RP-1-lineage papers, flagged provisional pending the primary), ISO/IEC 17025 **:2017**
  (no amendment since), ABNT NBR ISO/IEC 17025:2017. Re-confirm RP-1:2010 against the primary
  before the Method-5 math ships. Prefer the current primary edition; never rely on a dated
  secondary figure unverified (a 1987 paper's CI was wrong in the first draft).
- **Oracles independently checked:** `λ₀=0.034621` ✅, `i₀=4.694` ✅, Clopper–Pearson 18/20 @90%
  `[0.717, 0.982]` ✅ (the original draft's `[0.732, 0.976]` was wrong — fixed). The M5 i₀ CI was
  replaced with the reproducible delta-method `[1.47, 15.04]` (the cited `[3.48, 6.34]` could not
  be reproduced from the inputs and is statistically implausible for N=15).
- **Logic fix:** `UNKNOWN` cycles are now excluded from R (numerator AND denominator), not
  counted as failures — the draft would have driven R→0 and spuriously shortened intervals.
- **Open polish (track during implementation):** per-point family exposure weighting; precise
  same-day cycle-collapse rule; confirming `BetaInv` against the chosen library.

## References

- ILAC-G24/OIML D 10:2022 — https://www.oiml.org/en/files/pdf_d/d010-e22.pdf (§6.2/6.3/6.6)
- Jackson & Castrup 1987 · Bare 2006 (M1 multiplier) · PTB 2020 (M2 drift) · NCSL RP-1:2010 (paywalled) · ASQR-01 (≥95%)
- Phase A+B spec: `specs/calibration-interval-customer-owned/spec.md` · PR #597
