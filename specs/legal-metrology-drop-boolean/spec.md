# Drop the deprecated `subject_to_legal_metrology` boolean — Spec

> EARS spec (ears-spec + calibrafacil-domain). Deferred item #6 (final) of the legal-metrology
> epic (#423). Stacks on item 5 (offline parity). **PAIR-DON'T-LOOP** — touches the regulated
> repair-seal gating + sync + service-order snapshots. Built + verified, then **flagged for
> human review; NOT auto-merged.**

## Intent

`asset.subject_to_legal_metrology` was kept as a deprecated boolean, derived in lock-step with
`metrology_regime` (migration 0066), to avoid a big-bang rewrite of its ~13 read-sites. This
item completes the transition: migrate every read to `metrology_regime === 'LEGAL'`, then drop
the column (forward-only migration). `metrology_regime` becomes the single source of truth.

## Constraints

- **Behaviour-preserving.** `metrology_regime === 'LEGAL'` is exactly the old boolean (0066
  backfilled it that way and every write kept them in lock-step), so each replaced read MUST
  yield identical behaviour — especially the **repair-seal / lacre (Etiqueta de Reparo)
  gating**, which is legal-metrology-regulated.
- **Forward-only migration** (number **0069**); the `DROP COLUMN` is destructive, so it MUST
  ship in the SAME change that removes every read (code stops reading → migration drops). Per
  "migrate then deploy": the operator applies 0069 AFTER deploy. Mirror the local-db side
  (drop the offline column too, or leave it — state which).
- No RBAC/tenancy change. No `as`/`useEffect`. The cloud schema, CreateAsset/UpdateAsset, and
  client-runtime DTO all lose the field — update every consumer + test.

## Acceptance Criteria (EARS)

- REQ-DROPBOOL-001: Every read of `subjectToLegalMetrology` / `subject_to_legal_metrology`
  SHALL be replaced by a `metrology_regime === 'LEGAL'` predicate with identical behaviour —
  in particular the service-order repair-seal/lacre fields SHALL render iff the asset's
  `metrology_regime = 'LEGAL'` (service-order read-model, `ServiceOrderHtml`, web
  `detail-model` + `new-page`, worker). [HIGH RISK — regulated repair-seal gating]
- REQ-DROPBOOL-002: The portal family-pool exclusion (was `eq(asset.subjectToLegalMetrology,
false)`) SHALL exclude `metrology_regime = 'LEGAL'` siblings — identical pool. [HIGH RISK]
- REQ-DROPBOOL-003: `resolveAssetRegimeWrite` SHALL no longer emit `subjectToLegalMetrology`,
  and asset create/update + sync SHALL no longer write it; `metrology_regime` (+
  `regulated_interval`) remains the persisted regime state.
- REQ-DROPBOOL-004: The `asset.subject_to_legal_metrology` column SHALL be dropped by a
  forward-only migration **0069**; `packages/db/src/schema.ts`, `CreateAssetSchema` /
  `UpdateAssetSchema`, `packages/client-runtime` DTOs, `packages/local-db`, and
  `apps/api/src/routes/sync.ts` SHALL no longer reference the boolean.
- REQ-DROPBOOL-005: All tests referencing the boolean SHALL be migrated to `metrology_regime`;
  the full type-check + the regime / repair-seal / family-pool / sync test suites SHALL pass
  with no behaviour regression. [HIGH RISK]

## Out-of-scope

- Renaming/reshaping `metrology_regime` or `regulated_interval` (already the source of truth).
- The `INDUSTRIAL`/`UNKNOWN` distinction in gating — both map to "not legal" exactly as the
  old `false` did.

## Decomposition

| Mini-spec           | Layer (real path)                                                                                                                                                                | Risk                             | Mode                   |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ---------------------- |
| Migrate reads       | `service-order.read-model.ts`, `ServiceOrderHtml.tsx`, web `detail-model.tsx`/`new-page.tsx`, `worker/src/index.ts`, `portal.ts` (family pool + selects), `assets.ts`, `$id.tsx` | **high (repair-seal gating)**    | **pair-don't-loop**    |
| Drop column + types | `schema.ts` + `drizzle/0069_*.sql` + journal; `schemas`, `client-runtime`, `local-db` (+ its migration), `sync.ts`                                                               | **high (destructive migration)** | **pair-don't-loop**    |
| Test migration      | every `*.spec.ts`/`*.test.ts` referencing the boolean → `metrology_regime`                                                                                                       | med                              | loopable-with-verifier |

**Pairing note:** the repair-seal gating (001) + the destructive migration (004) are
pair-don't-loop. Each behaviour-preserving claim needs a test proving the regime predicate
gates exactly as the boolean did (e.g. a LEGAL asset's service order still shows the
Etiqueta-de-Reparo/lacre fields; a non-LEGAL one does not). **Build + verify, then STOP for
human review — do not merge.**
