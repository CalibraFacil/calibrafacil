# Legal-metrology polish + coverage — Spec

> EARS spec (ears-spec + calibrafacil-domain). Deferred item #4 of the legal-metrology epic
> (#423). Stacks on item 3 (catalog). Closes the verifier-noted polish/coverage gaps on the
> regime feature: inline field errors on the lab regime form, and explicit integration
> assertions for REQ-MLR-012 (400 on a bad regulated interval) and REQ-MLR-042 (portal write
> leaves Track 2 untouched). No new migration.

## Intent

The regime feature shipped two thin spots flagged in review: (1) `MetrologyRegimeFields`
blocks a bad LEGAL submission with a form-level message but does not highlight the offending
regulated field inline (the parse already produces field-keyed errors — they just aren't
displayed in the component); (2) REQ-MLR-012 (a malformed `regulatedInterval` is rejected with 400) and REQ-MLR-042 (a portal calibration-interval write never touches the Track-2 columns)
rely on structural guarantees rather than explicit integration assertions. This item adds the
inline errors and the two assertions. Purely additive; no behavior change to the API.

## Constraints

- No new migration. No `as`/`useEffect`. Reuse the existing form `errors` map + `FieldError`
  component; reuse the existing int-spec harnesses (`assets.int.spec.ts`,
  `portal-asset-interval.int.spec.ts`). Extend the existing
  `metrology-regime-fields.test.tsx` render harness for the UI assertion.
- Do NOT change the API validation or the portal write logic — REQ-MLR-012/042 behavior
  already exists; this only adds tests that fail on regression.

## Acceptance Criteria (EARS)

- REQ-POLISH-001: `MetrologyRegimeFields` SHALL accept a field-error map and render an inline
  `FieldError` for each regulated field (`regulationReference`, `regulatedValueMonths`,
  `regulatedTechnology`, `regulatedAnchor`) that has an error; the lab asset create + edit
  forms SHALL pass the relevant field errors through. (hardens REQ-MLR-062/063)
- REQ-POLISH-002: WHEN a lab member POSTs or PUTs an asset with `metrologyRegime='LEGAL'` and a
  malformed `regulatedInterval` (e.g. empty `regulationReference`, or `valueMonths` outside
  `[1,600]`), the API SHALL reject with `400` and persist no `regulated_interval` /
  `next_legal_verification_date` — an integration test SHALL assert this (REQ-MLR-012). [HIGH RISK]
- REQ-POLISH-003: WHEN a portal `client_user` PUTs the calibration interval on a LEGAL asset
  that has a `regulated_interval` + `next_legal_verification_date`, the API SHALL leave both
  Track-2 columns byte-unchanged (only Track-1 `calibration_interval_months` /
  `next_calibration_date` change) — an integration test SHALL assert this (REQ-MLR-042). [HIGH RISK]

## Decomposition

| Mini-spec         | Layer (real path)                                                                                                                  | Risk | Mode                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---- | ---------------------- |
| Inline FieldError | `apps/web/.../metrology-regime-fields.tsx` (+ `errors` prop) + create/edit forms pass-through + `metrology-regime-fields.test.tsx` | low  | loopable-with-verifier |
| REQ-MLR-012 int   | `apps/api/src/routes/assets.int.spec.ts` (LEGAL + bad regulatedInterval → 400, no row)                                             | med  | loopable-with-verifier |
| REQ-MLR-042 int   | `apps/api/src/routes/portal-asset-interval.int.spec.ts` (portal interval write leaves Track 2 untouched)                           | med  | loopable-with-verifier |

**Pairing note:** all loopable-with-verifier. REQ-POLISH-002/003 are HIGH RISK assertions of
existing regulated behavior — each needs a test that fails if the validation/track-independence
regressed.
