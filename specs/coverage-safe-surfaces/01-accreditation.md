# Mini-spec: accreditation helpers coverage

Target: `packages/shared/src/accreditation.ts`
Test file: `packages/shared/src/accreditation.test.ts` (Vitest)

## Context
Pure helpers for ISO/IEC 17025 accreditation: normalize/format the accreditation
number (digits-only storage, `CAL`-prefixed display) and decide accreditation
status + seal emission. Used on issued certificates → assert exact strings VERBATIM.

## Acceptance Criteria

- REQ-ACCR-001: WHEN `normalizeAccreditationNumber` receives free-form input
  (`"RBC 0123"`, `"CAL-0123"`, `"0123"`), the function SHALL return digits-only
  `"0123"`.
- REQ-ACCR-002: WHEN `normalizeAccreditationNumber` receives more than 6 digits,
  the function SHALL truncate to the first 6 digits.
- REQ-ACCR-003: WHEN `normalizeAccreditationNumber` receives input with no digits,
  the function SHALL return the empty string.
- REQ-ACCR-004: WHEN `formatAccreditationNumber` receives a value containing digits,
  the function SHALL return `"CAL "` followed by the normalized digits (e.g.
  `"CAL 0123"`).
- REQ-ACCR-005: IF `formatAccreditationNumber` receives `null`, `undefined`, or a
  digitless string, THEN the function SHALL return `null`.
- REQ-ACCR-006: IF `getAccreditationStatus` receives a profile whose
  `accreditationActive` is falsy, THEN the function SHALL return `"inactive"`.
- REQ-ACCR-007: WHEN `getAccreditationStatus` receives `accreditationActive: true`
  with a digit-bearing `accreditationNumber`, the function SHALL return `"active"`.
- REQ-ACCR-008: IF `getAccreditationStatus` receives `accreditationActive: true`
  but a missing/digitless `accreditationNumber`, THEN the function SHALL return
  `"incomplete"`.
- REQ-ACCR-009: The `isAccreditationActive` predicate SHALL return `true` only when
  `getAccreditationStatus` is `"active"` (false for `"incomplete"`/`"inactive"`).
- REQ-ACCR-010: WHEN `shouldRenderAccreditationSeal` receives an active lab AND
  `methodAccreditedScope === true`, the function SHALL return `true`. [REVIEW: emits
  the accreditation seal on a certificate]
- REQ-ACCR-011: IF the lab is active but `methodAccreditedScope` is `false`/`null`/
  `undefined`, THEN `shouldRenderAccreditationSeal` SHALL return `false`. [REVIEW]
- REQ-ACCR-012: The exported seal constants SHALL equal the regulated strings
  verbatim: `ACCREDITATION_SEAL_SUBTITLE === "NBR ISO/IEC 17025"`,
  `ACCREDITATION_NUMBER_PREFIX === "CAL"`, `ACCREDITATION_SEAL_TITLE === "Calibração"`.
