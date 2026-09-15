# Legal-metrology offline / local-db parity — Spec

> EARS spec (ears-spec + calibrafacil-domain). Deferred item #5 of the legal-metrology epic
> (#423). Stacks on item 4 (polish). The same React frontend runs cloud and desktop/offline;
> most architecture exists to keep the two in parity (CLAUDE.md). The epic's new asset columns
> were added to the cloud Postgres schema only — this mirrors them into the offline SQLite
> store + the sync path so a desktop/offline lab carries the legal-metrology regime + the
> install anchor, and they reconcile to the cloud.

## Intent

`asset.metrology_regime`, `regulated_interval`, `next_legal_verification_date` (migration 0066) and `installed_at` (0067) exist only in `packages/db` (cloud Postgres). The offline
store (`packages/local-db`, SQLite) and the sync path (`packages/sync` +
`apps/api/src/routes/sync.ts`) do not carry them, so a desktop/offline edit of an
instrument's regime is lost / not reconciled. Mirror the four columns through the offline +
sync surfaces. (Note: the customer-owned interval columns from 0065 —
`calibration_interval_months` etc. — were also never mirrored; out-of-scope here unless trivial.)

## Constraints

- **Mirror the established pattern** — follow `packages/local-db/src/migrations/0009_asset_subject_to_legal_metrology.ts` (the boolean's offline migration) for shape; the local-db migration journal is **separate** from `packages/db` (next local-db migration number, not 0068). SQLite types: `metrology_regime`→TEXT, `regulated_interval`→TEXT (JSON string), `next_legal_verification_date`/`installed_at`→TEXT (ISO) or INTEGER — match how the existing offline asset dates are stored.
- **Additive + forward-only** offline migration; **idempotent** (offline migrations re-run on every client). No data loss.
- **Round-trip integrity** — a value written offline survives the local-db asset read/write AND the sync upsert (no column dropped on the way to/from the cloud). Reuse the existing sync conflict/outbox machinery unchanged.
- No `as`/`useEffect`. No change to the cloud `packages/db` schema (the columns already exist). No RBAC/tenancy change.

## Acceptance Criteria (EARS)

- REQ-OFFLINE-001: The local-db `asset` schema SHALL include `metrology_regime`,
  `regulated_interval`, `next_legal_verification_date`, and `installed_at`, added by an
  additive, idempotent local-db migration (mirroring 0009's pattern).
- REQ-OFFLINE-002: WHEN an asset is created/updated in the local-db store with these fields,
  the local-db read SHALL return them round-trip (write→read identity), including a structured
  `regulated_interval`. [HIGH RISK]
- REQ-OFFLINE-003: WHEN the sync path upserts an asset (offline→cloud and cloud→offline), the
  four columns SHALL be carried through `apps/api/src/routes/sync.ts` + `packages/sync` +
  `packages/local-db` upsert SQL — none dropped or defaulted away. [HIGH RISK]
- REQ-OFFLINE-004: The offline migration SHALL be idempotent (a second run SHALL NOT error or
  duplicate columns) and SHALL preserve existing offline asset rows.

## Decomposition

| Mini-spec                   | Layer (real path)                                                                                               | Risk                      | Mode                                       |
| --------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------ |
| local-db schema + migration | `packages/local-db/src/migrations/*` (new) + `migrations/index.ts` + the asset schema/CRUD (`assets.ts`)        | med                       | pair-don't-loop (offline migration review) |
| sync carry-through          | `packages/local-db/src/sync.ts` upsert SQL + `packages/sync` + `apps/api/src/routes/sync.ts` asset column lists | **high (sync integrity)** | loopable-with-verifier                     |

**Pairing note:** REQ-OFFLINE-002/003 each need a test that fails on regression — a local-db
write→read round-trip (incl. the structured `regulated_interval`) and a sync upsert that
asserts the four columns survive. Mirror the existing local-db / sync test harness.
