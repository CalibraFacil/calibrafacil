# Legal-metrology regulation catalog — Spec

> EARS spec (ears-spec + calibrafacil-domain). Deferred item #3 of the legal-metrology epic
> (#423). Stacks on item 2 (installed_at). Seed data (primary-grounded 2026-06-29):
> `.goals/legal-metrology-catalog-seed.md`.

## Intent

Today the lab types the governing Portaria + the full regulated-interval shape by hand for
every LEGAL asset (in `MetrologyRegimeFields`). A small, in-house `legal_metrology_regulation`
lookup — seeded with the grounded Portaria→period-shape table — lets the lab pick a regulation
and **auto-fill** the regulated-interval fields (a default the lab can still override, since the
regime is use-dependent). There is no public Inmetro registry (grounding confirmed), so this is
a curated reference table, with **provenance** so primary vs secondary rows are distinguishable.

## Constraints

- **Forward-only hand-authored migration** — new table; **migration number 0068**; operator
  applies prod+dev. The seed runs idempotently (re-runnable; `ON CONFLICT DO NOTHING` on a
  natural key) and is data-only (it SHALL NOT modify any `asset` row).
- **Global reference data** — the catalog is not tenant-scoped (the same Portarias apply to
  every lab); the read endpoint requires auth but no special role (reuse an existing guard).
- **Suggestion-only** — selecting a catalog entry pre-fills the editable regime fields; it
  SHALL NOT lock them. The lab remains the source of truth per asset.
- **Provenance honesty** — SECONDARY rows (gas per-technology, hidrômetro — see seed doc) MUST
  be flagged so the UI shows a "(verificar artigo no DOU)" caveat; the seed MUST NOT silently
  present a secondary value as authoritative. `kind` values reuse `RegulatedInterval['kind']`.
- pt-BR copy. No `as`/`useEffect`. Portal/web import boundaries unchanged.

## Acceptance Criteria (EARS)

- REQ-CATALOG-001: A `legal_metrology_regulation` table SHALL exist (migration 0068) with:
  `id`, `category` (label), `kind` (`fixed_months|max_months_from_install|per_technology|not_nationally_fixed`),
  `value_months` (nullable int), `by_technology` (nullable jsonb), `anchor`,
  `operationalized_by_delegate` (bool), `regulation_reference` (text), `provenance`
  (`primary|secondary`), `note` (nullable), and a unique natural key for idempotent seeding.
- REQ-CATALOG-002: The seed SHALL populate the grounded entries from `.goals/legal-metrology-catalog-seed.md`
  (taxímetro 24 / cronotacógrafo 24 / etilômetro 12 / radar 12 / balança 12 calendar_year /
  esfigmo 12 / gás per-technology / hidrômetro ≤84 install / energia not_nationally_fixed),
  each with the correct `regulation_reference` (verbatim Portaria) and `provenance`
  (**gás + hidrômetro = secondary**, the rest primary). [HIGH RISK — regulatory data]
- REQ-CATALOG-003: WHEN an authenticated lab user requests the catalog list endpoint, the API
  SHALL return the catalog entries; IF unauthenticated, THEN it SHALL reject with 401.
- REQ-CATALOG-004: WHEN a lab user selects a catalog entry in the regime form, the form SHALL
  populate `regulatedKind`, `valueMonths`/`technology`, `anchor`, `regulationReference`, and
  `operationalizedByDelegate` from it, and the user SHALL be able to override any field afterward.
- REQ-CATALOG-005: WHERE a selected catalog entry's `provenance` is `secondary`, the form SHALL
  display a "(verificar artigo no DOU)" caveat near the auto-filled regulation reference.
- REQ-CATALOG-006: The seed migration SHALL NOT modify any existing `asset` row
  (`metrology_regime` / `regulated_interval` / dates unchanged); selecting a catalog entry SHALL
  only pre-fill the form, never write an asset directly. [HIGH RISK]

## Out-of-scope / Deferred
- Re-confirming the SECONDARY rows (gas per-tech article, hidrômetro anchor) against the official
  DOU — an operator step recorded in the seed doc; the rows ship flagged `secondary`.
- Per-lab custom catalog overrides / a catalog admin UI.

## Decomposition

| Mini-spec | Layer (real path) | Risk | Mode |
| --- | --- | --- | --- |
| Table + migration 0068 + idempotent seed | `packages/db/src/schema.ts` + `drizzle/0068_*.sql` + a seed (mirror `seed-asset-types.ts`) | **high (regulatory data)** | pair-don't-loop (migration + seed review) |
| List endpoint | `apps/api/src/routes/*` (reuse an auth guard) | low | loopable-with-verifier |
| Form auto-fill + caveat | `apps/web/.../metrology-regime-fields.tsx` + `forms.ts` (a catalog query + a select that patches the regime fields) | med | loopable-with-verifier |

**Pairing note:** the seed is regulated reference data — REQ-CATALOG-002 needs a test asserting
the seeded rows match the grounded references + provenance flags, and REQ-CATALOG-006 needs a test
that the seed touches no asset row. Provenance MUST be carried through to the UI caveat (005).
