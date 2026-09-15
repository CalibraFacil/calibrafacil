# Mini-spec: certificate formatters coverage

Target: `packages/certificate-data/src/formatters.ts`
Test file: `packages/certificate-data/src/formatters.test.ts` (Vitest)

## Context

`getPath` + `formatValue` (date/number/boolean dispatch) resolve and format the
values that land in a certificate. Output-critical → assert exact strings. Date
formatting uses UTC; lock that in.

> The module moved out of the deleted `packages/certificate-xlsx-template` when the
> lab-authored XLSX certificate path was removed. It was never XLSX-specific — it is
> a generic path/format helper — and it now feeds the fixed system layouts. The
> `REQ-XLSX-*` ids are kept **verbatim** so the criteria stay traceable; do not
> renumber them for cosmetic reasons.

## Acceptance Criteria

- REQ-XLSX-001: WHEN `getPath` is given a dotted path into a nested object
  (`"a.b.c"`), the function SHALL return the leaf value.
- REQ-XLSX-002: IF `getPath` traverses through a `null`/`undefined`/non-object
  segment, THEN the function SHALL return `undefined` (no throw).
- REQ-XLSX-003: IF `formatValue` receives `null` or `undefined`, THEN the function
  SHALL return the empty string `""`.
- REQ-XLSX-004: WHEN `formatValue` receives a `Date` with formatter `"yyyy-mm-dd"`,
  the function SHALL return the UTC ISO date (`toISOString().slice(0,10)`).
- REQ-XLSX-005: WHEN `formatValue` receives a `Date` with formatter `"dd/mm/yyyy"`,
  the function SHALL return the pt-BR `DD/MM/YYYY` form computed in UTC.
- REQ-XLSX-006: WHEN `formatValue` receives a `Date` with no/other formatter, the
  function SHALL return the full ISO string (`toISOString()`).
- REQ-XLSX-007: WHEN `formatValue` receives a number with formatter `"number:2"`,
  the function SHALL return `value.toFixed(2)`; with no/invalid numeric formatter it
  SHALL return `String(value)`.
- REQ-XLSX-008: WHEN `formatValue` receives a boolean, the function SHALL return
  `"true"`/`"false"`.
- REQ-XLSX-009: WHEN `formatValue` receives a string with a `"date:<style>"` formatter
  and the string parses to a valid Date, the function SHALL format it as that date
  style; IF the string does not parse, THEN it SHALL return the original string.
