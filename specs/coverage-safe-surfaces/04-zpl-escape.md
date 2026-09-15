# Mini-spec: ZPL field escaping coverage

Target: `packages/label-rendering/src/zpl/escape.ts`
Test file: `packages/label-rendering/src/zpl/escape.test.ts` (Vitest — EXTEND existing;
do not weaken existing assertions)

## Context

`escapeZplField(text)` escapes label text for ZPL `^FH` hex mode. The caret/tilde/
underscore/backslash are ZPL control chars and MUST become `_XX`; other printable
ASCII passes through; non-ASCII (multi-byte UTF-8) becomes per-byte `_XX` uppercase.
Output-critical (printer commands / injection surface).

## Acceptance Criteria

- REQ-ZPL-001: WHEN the input is printable ASCII with no control chars (e.g.
  `"ABC 123"`), the function SHALL return it unchanged.
- REQ-ZPL-002: WHEN the input contains a ZPL control char (`^`, `~`, `_`, `\`), the
  function SHALL replace each with its `_XX` uppercase-hex byte (`^`→`_5E`, `~`→`_7E`,
  `_`→`_5F`, `\`→`_5C`).
- REQ-ZPL-003: WHEN the input contains a multi-byte UTF-8 character (e.g. `"ç"` =
  bytes 0xC3 0xA7), the function SHALL emit one `_XX` token per UTF-8 byte
  (`"_C3_A7"`), enabling `^CI28` round-trip.
- REQ-ZPL-004: WHEN the input contains a control/non-printable ASCII byte below 0x20
  (e.g. newline 0x0A), the function SHALL emit `_0A` (uppercase, zero-padded to 2).
- REQ-ZPL-005: WHEN the input is empty, the function SHALL return the empty string.
- REQ-ZPL-006: The hex emitted SHALL always be two uppercase hex digits
  (zero-padded), verified on a byte < 0x10.
