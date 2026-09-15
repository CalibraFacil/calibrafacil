# Mini-spec: method preview render coverage

Target: `packages/method-definition/src/preview.ts` (`runMethodPreview`)
Test file: `packages/method-definition/tests/preview.test.ts` (Vitest)

## Context

`runMethodPreview(...)` renders a read-only, deterministic preview of a method
definition (phases, watermarking, metadata, accreditation-seal rules) for operator
feedback. Large single export (~1.5k lines of internal helpers). This pass targets the
HIGH-VALUE, DETERMINISTIC branches reachable from the public entrypoint — NOT 100% of
the file. Implementer: READ `runMethodPreview`'s signature + existing method-definition
fixtures (reuse one the package already tests with) and assert structural output.
**No silent caps:** in your report, explicitly list which branches you covered and
which you intentionally left uncovered and why.

## Acceptance Criteria

- REQ-PREV-001: WHEN `runMethodPreview` is given a valid method definition + inputs,
  the function SHALL return a preview object with the expected top-level shape
  (assert the documented/observed keys, e.g. phases/result/metadata).
- REQ-PREV-002: WHEN the preview is a draft/non-released method, the function SHALL
  mark it as a preview/watermarked (assert the flag/field that signals "not a real
  certificate").
- REQ-PREV-003: WHEN inputs drive an acceptance-criterion outcome, the preview SHALL
  reflect the pass/fail (or conformity) state derived from those inputs.
- REQ-PREV-004: IF the method definition is invalid/incomplete in a way the function
  guards, THEN `runMethodPreview` SHALL surface the error/empty state deterministically
  (no throw past the guard) — assert the observed behavior.
- REQ-PREV-005: The preview output SHALL be deterministic for fixed inputs (calling
  twice yields deep-equal output) — guards against hidden Date/random in the render
  path.

Note: preview is metrology-display-adjacent. Assert EXISTING behavior; if outputs look
wrong (e.g. a conformity verdict), FLAG rather than "fix" the test to match.
