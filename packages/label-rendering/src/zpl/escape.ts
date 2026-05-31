// ZPL field-data escaping.
//
// Inside `^FD … ^FS`, the caret `^` and tilde `~` are the ZPL command prefixes,
// so a literal `^`/`~` in user text would be parsed as a command and corrupt —
// or maliciously rewrite — the label. We emit text for ZPL's hexadecimal field
// mode (`^FH`), where `_xx` byte sequences are decoded back to raw bytes;
// combined with `^CI28` (UTF-8) on the label, Portuguese accents round-trip. The
// hex-indicator char is `_`, so a literal `_` must itself be escaped.

const ALWAYS_ESCAPE = new Set(["^", "~", "_", "\\"]);

/**
 * Escape arbitrary text for use inside a `^FH`-prefixed `^FD` field. Printable
 * ASCII passes through except the ZPL control characters above; every other byte
 * (including multi-byte UTF-8) becomes `_XX` hex.
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
