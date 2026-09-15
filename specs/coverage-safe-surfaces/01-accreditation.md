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
  verbatim: `ACCREDITATION_SEAL_SCHEME === "ABNT NBR ISO/IEC 17025"`,
  `ACCREDITATION_SEAL_SCHEME_LINE1 === "ABNT NBR"`,
  `ACCREDITATION_SEAL_SCHEME_LINE2 === "ISO/IEC 17025"`,
  `ACCREDITATION_NUMBER_PREFIX === "CAL"`.
  Source: **NIE-Cgcre-009 rev. 27 (Jul/2024) A.5/A.8** — the upper band carries the
  accreditation-scheme norm, and the accreditation type is carried by the `CAL`
  codification in the lower band. Rev. 27 replaced the previous three-line wording
  ("Calibração / NBR ISO/IEC / 17025"); §4.1 gave a 3-year transition, to Jul/2027.
  See `docs/referencias/nie-cgcre-009-simbolo-acreditacao.md`.
- REQ-ACCR-013: `ACCREDITATION_SEAL_FONT_FAMILY` SHALL name Arial before any other
  family, per NIE-Cgcre-009 A.6.2 (_"A fonte da letra a ser usada no símbolo é a
  Arial"_). A Calibri clone such as Carlito must not precede it: Carlito ships with
  LibreOffice and would win inside the Gotenberg Chromium container.
- REQ-ACCR-014: IF `shouldRenderAccreditationSeal` is told that any result on the
  certificate came from an external provider (`hasExternalProviderResults === true`),
  THEN it SHALL return `false` regardless of every other input. [HIGH RISK]
  Source: **NIE-Cgcre-009 §11.5.3 / §11.5.4 / §11.5.5**.
  Fail-closed tripwire, not a finished feature: subcontracting is not modelled, so no
  call site passes this today and behaviour is unchanged. It exists so that whoever
  models it cannot ship a sealed certificate without first implementing per-result
  attribution (provider name, accreditation number, accrediting body — §11.5.4) and
  the "every result external ⇒ no symbol at all" prohibition (§11.5.5). Distinguishing
  "some external, all accredited" (allowed, §11.5.3 b) from "all external" (forbidden)
  requires attribution that does not exist; until it does, suppressing is the safe
  answer. An unsealed certificate is merely not-accredited; a wrongly sealed one is
  symbol misuse under §11.1.8.
