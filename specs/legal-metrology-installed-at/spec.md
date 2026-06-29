# `installed_at` anchor for the regulated verification periodicity — Spec

> EARS spec (ears-spec + calibrafacil-domain). Deferred item #2 of the legal-metrology epic
> (#423). Stacks on item 1 (legal-verification recall). Source: `specs/legal-metrology-regime/spec.md`.

## Intent

The regulated-interval `max_months_from_install` shape (hidrômetros — verification due ≤N
months from the year of installation) currently **derives no date**: `deriveRegulatedNextDate`
returns `null` for it because the `asset` has no install/commission date to anchor on
(`installDate: null` is passed at both call sites). This adds a nullable `asset.installed_at`
and feeds it as the install anchor, so an install-anchored regulated interval finally derives
a real `next_legal_verification_date`. Purely additive; no other kind's behavior changes.

## Constraints

- **Forward-only hand-authored migration** (`pnpm db:generate` broken past 0006) — add the
  `.sql` + a `_journal.json` entry by hand; **use migration number 0067** (0066 is the regime
  migration on the base); additive nullable column; operator applies prod+dev.
- **No `as`/`useEffect`.** Reuse the existing pure `deriveRegulatedNextDate`
  (`apps/api/src/lib/regulated-interval.ts`) — do not change its signature beyond reading the
  supplied `installDate` anchor (already a parameter).
- Lab-only field; reuse `withLabPermission({ equipment: [...] })` for writes (no new rule).
- Only `max_months_from_install` is affected; `fixed_months` / `per_technology` /
  `not_nationally_fixed` derivations SHALL be unchanged.

## Acceptance Criteria (EARS)

- REQ-INSTALL-001: The `asset` table SHALL have a nullable `installed_at` timestamp
  (migration 0067, additive).
- REQ-INSTALL-002: WHEN a LEGAL asset's `regulated_interval.kind = max_months_from_install`
  and `installed_at` is set, the system SHALL derive `next_legal_verification_date =
  installed_at + valueMonths` (via `deriveRegulatedNextDate` with `installDate = installed_at`). [HIGH RISK]
- REQ-INSTALL-003: IF `installed_at` is null and `kind = max_months_from_install`, THEN
  `next_legal_verification_date` SHALL remain null (no fabricated date). [HIGH RISK]
- REQ-INSTALL-004: WHEN a lab member with `equipment:update` (or create) sets `installed_at`,
  the API SHALL persist it; the lab asset create/edit form SHALL expose an optional
  installation-date control (pt-BR), pre-filled on edit.
- REQ-INSTALL-005: The install anchor SHALL affect ONLY `max_months_from_install`; the
  derived date for `fixed_months` (last_verification / calendar_year) and `per_technology`
  SHALL be byte-for-byte unchanged by the presence/absence of `installed_at`.

## Decomposition

| Mini-spec | Layer (real path) | Risk | Mode |
| --- | --- | --- | --- |
| `installed_at` column + migration 0067 | `packages/db/src/schema.ts` + `packages/db/drizzle/0067_*.sql` + journal | med (migration) | pair-don't-loop (migration review) |
| Anchor wiring | `apps/api/src/routes/assets.ts` (both `deriveRegulatedNextDate` calls → `installDate: installedAt`) + `CreateAsset/UpdateAssetSchema` (`installedAt` optional ISO) | **high (derivation)** | loopable-with-verifier |
| Response + form | GET selects + `AssetDetailData` (client-runtime) + `asset-create/edit-form.tsx` (DatePicker, mirror `lastCalibrationDate`) | low | loopable-with-verifier |

**Pairing note:** the migration + derivation are the regulated core — REQ-INSTALL-002/003 each
need a test (unit on `deriveRegulatedNextDate` + an int test on the lab write that asserts the
derived `next_legal_verification_date`). REQ-INSTALL-005 needs a test proving other kinds are
unaffected.
