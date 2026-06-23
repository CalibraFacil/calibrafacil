# Mini-spec: product-to-draft transform coverage

Target: `packages/method-templates/src/product-to-draft.ts` (`buildDraftFromProduct`)
Test file: `packages/method-templates/src/product-to-draft.test.ts` (Vitest)

## Context
`buildDraftFromProduct(source)` converts a product-format template definition into a
compilable method-definition draft (normalizes fields, formulas, validations,
bindings). Feeds the method fingerprint (existing `fingerprint.test.ts` covers
end-to-end identity; this spec covers the transform's BRANCHES at unit level).
Implementer: READ the source + `ProductDraftSource` type and an existing platform
template (e.g. a registered product in this package) to derive a realistic input;
assert the EXACT normalized output. Do NOT change production behavior.

## Acceptance Criteria

- REQ-P2D-001: WHEN `buildDraftFromProduct` receives a minimal valid product source,
  the function SHALL return a draft whose method id is sanitized via `safeMethodId`
  (starts with a letter; only `[A-Za-z0-9_]`).
- REQ-P2D-002: WHEN the product defines input/data fields, the function SHALL map each
  to the draft's field shape, preserving field keys and types (assert the produced
  field list for a representative product).
- REQ-P2D-003: WHEN the product defines formulas/derived quantities, the function SHALL
  carry them into the draft's formula list with their identifiers intact.
- REQ-P2D-004: WHEN the product defines acceptance criteria / validations, the function
  SHALL include them in the draft (count + key fields preserved).
- REQ-P2D-005: The returned draft SHALL contain no `undefined`-valued keys (the
  transform strips them via `stripUndefinedDeep`), so the object is fingerprint-stable.
- REQ-P2D-006: IF an optional product section is absent, THEN the corresponding draft
  section SHALL be empty/omitted rather than throwing.

Implementer: report exactly which product fixture you used and which REQs map to which
assertions; flag any branch you could not reach.
