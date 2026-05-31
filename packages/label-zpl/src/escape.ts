// ZPL field-data escaping.
//
// Inside `^FD … ^FS`, the caret `^` and tilde `~` are the ZPL command prefixes,
// so a literal `^`/`~` in user text (e.g. an asset tag) would be parsed as a
// command and corrupt — or maliciously rewrite — the label. To embed arbitrary
// UTF-8 text safely we emit it for ZPL's hexadecimal field mode (`^FH`), where
// `_xx` byte sequences are decoded back to raw bytes. Combined with `^CI28`
// (UTF-8 input) on the label, Portuguese accents (ç, ã, é, õ, …) round-trip
// correctly.
//
// The hex-indicator character in `^FH` mode is `_` by default, so a literal `_`
// in the data must itself be escaped.

// Characters that are otherwise printable ASCII but carry meaning to the parser
// (or to `^FH`) and must always be hex-escaped.
const ALWAYS_ESCAPE = new Set(["^", "~", "_", "\\"]);

/**
 * Escape arbitrary text for use inside a `^FH`-prefixed `^FD` field.
 *
 * Printable ASCII (0x20–0x7E) passes through untouched except for the ZPL
 * control characters above; every other byte (including all multi-byte UTF-8
 * sequences) is emitted as `_XX` hex so it survives `^FH` decoding under
 * `^CI28`.
 */
export function escapeZplField(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let out = "";

  for (const byte of bytes) {
    const isPrintableAscii = byte >= 0x20 && byte <= 0x7e;
    const char = String.fromCharCode(byte);

    if (isPrintableAscii && !ALWAYS_ESCAPE.has(char)) {
      out += char;
    } else {
      out += `_${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }

  return out;
}
