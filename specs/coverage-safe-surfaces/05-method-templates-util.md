# Mini-spec: method-templates util coverage

Target: `packages/method-templates/src/util.ts`
Test file: `packages/method-templates/src/util.test.ts` (Vitest)

## Context

`safeMethodId` + `stripUndefinedDeep` feed the method fingerprint, so behavior must
not drift (fingerprint is audit-relevant). Assert exact transforms.

## Acceptance Criteria

- REQ-MTU-001: WHEN `safeMethodId` receives a string with disallowed chars (e.g.
  `"a-b.c d"`), the function SHALL replace every char outside `[a-zA-Z0-9_]` with
  `_` (→ `"a_b_c_d"`).
- REQ-MTU-002: IF the sanitized id does not start with an ASCII letter (starts with
  a digit or `_`, e.g. input `"123"` → `"123"`), THEN `safeMethodId` SHALL prefix it
  with `"method_"` (→ `"method_123"`).
- REQ-MTU-003: IF `safeMethodId` receives `undefined`, THEN it SHALL fall back to the
  base `"method_draft"`.
- REQ-MTU-004: WHEN `safeMethodId` receives a number, the function SHALL stringify it
  first and apply the same rules (e.g. `42` → `"method_42"`).
- REQ-MTU-005: WHEN `stripUndefinedDeep` receives a nested object with `undefined`
  values, the function SHALL omit every `undefined`-valued key at every depth while
  preserving `null`, `0`, `false`, and `""`.
- REQ-MTU-006: WHEN `stripUndefinedDeep` receives an array, the function SHALL map
  over elements recursively (array length preserved; nested undefined keys stripped).
- REQ-MTU-007: WHEN `stripUndefinedDeep` receives a primitive or `null`, the function
  SHALL return it unchanged.
