import { hasControlCharacter } from "./deep-link-path";

/**
 * Filenames for files the desktop writes to the user's disk.
 *
 * The old behaviour offered `12.pdf` — the job's numeric id — which is
 * meaningless in a downloads folder six months later, and is exactly the name
 * the *next* certificate would suggest too.
 *
 * Two constraints make this less trivial than joining strings:
 *
 * - **Certificate numbers contain slashes.** `R-0001/2026` is the real format.
 *   Left alone it becomes a path separator, and the save dialog silently
 *   writes into a directory that may not exist.
 * - **Windows reserves device names.** `CON`, `PRN`, `AUX`, `NUL`, `COM1`-`COM9`
 *   and `LPT1`-`LPT9` cannot be used as a filename *even with an extension*,
 *   and trailing dots or spaces are stripped by the shell, which turns
 *   `certificado .pdf` into something the app did not choose.
 */

/** `CON.pdf` is still `CON` to Windows. Compared case-insensitively. */
const WINDOWS_RESERVED_NAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`),
]);

/**
 * Bounded in **UTF-8 bytes**, not code units: the usual Linux limit is 255
 * bytes per path component, and a stem of 120 CJK characters is well past
 * 300 bytes — the write would fail with ENAMETOOLONG. Leaves room for the
 * extension.
 */
const MAX_STEM_BYTES = 180;

export type CertificateFileNameInput = {
  certificateNumber?: string | null;
  jobId?: string | number | null;
  customerName?: string | null;
};

/**
 * `Certificado_R-0001-2026_Laboratorio-Exemplo.pdf` rather than `12.pdf`.
 *
 * Falls back through certificate number → job id → a bare label, so a draft
 * with no number yet still produces something sane.
 */
export function buildCertificateFileName(
  input: CertificateFileNameInput,
): string {
  const identifier =
    sanitizeSegment(input.certificateNumber) ||
    sanitizeSegment(input.jobId == null ? null : String(input.jobId));
  const customer = sanitizeSegment(input.customerName);

  const stem = ["Certificado", identifier, customer]
    .filter((part) => part.length > 0)
    .join("_");

  return `${finalizeStem(stem, "Certificado")}.pdf`;
}

export function buildSupportBundleFileName(now: Date = new Date()): string {
  // Sortable, filename-safe instant: the operator is usually attaching the
  // newest bundle to a ticket.
  const stamp = now.toISOString().replace(/[:.]/g, "-");

  return `${finalizeStem(`calibrafacil-suporte_${stamp}`, "calibrafacil-suporte")}.json`;
}

/**
 * Reduces one field to a filename-safe segment: strips path separators and
 * characters Windows rejects, collapses whitespace and runs of separators, and
 * keeps accented letters, which are ordinary in customer names here.
 */
export function sanitizeSegment(value: string | null | undefined): string {
  if (typeof value !== "string") return "";

  return (
    value
      .normalize("NFC")
      .trim()
      // Path separators and the characters Windows forbids in a name.
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, "-")
      // Anything left that a filesystem or a shell would treat oddly. Shares
      // the deep-link module's control-character definition rather than
      // restating the code-point range one file over.
      .split("")
      .filter((character) => !hasControlCharacter(character))
      .join("")
      .replace(/-{2,}/g, "-")
      .replace(/^[-_.]+|[-_.]+$/g, "")
  );
}

/**
 * Applies the whole-name rules: length, Windows device names, and the
 * trailing dot/space the Windows shell would strip behind our back.
 *
 * Exported because the device-name guard cannot fire through the builders
 * above — both prefix a constant, so their stems are never a bare `CON`. It
 * belongs to *this* helper's contract, for any caller that composes a name
 * without a prefix, and is tested here directly rather than left as a branch
 * nothing reaches.
 */
export function finalizeStem(stem: string, fallback: string): string {
  const trimmed = truncateToBytes(stem, MAX_STEM_BYTES).replace(/[.\s]+$/, "");
  if (!trimmed) return fallback;

  if (WINDOWS_RESERVED_NAMES.has(trimmed.toLowerCase())) {
    // Suffixing beats replacing: the user still sees what the file is.
    return `${trimmed}-arquivo`;
  }

  return trimmed;
}

/**
 * Truncate to a UTF-8 byte budget without splitting a character.
 *
 * Iterating by code point rather than slicing by index is what keeps a
 * surrogate pair — an emoji, say — from being cut in half into an invalid
 * sequence.
 */
export function truncateToBytes(value: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(value).length <= maxBytes) return value;

  let result = "";
  let used = 0;

  for (const character of value) {
    const size = encoder.encode(character).length;
    if (used + size > maxBytes) break;

    result += character;
    used += size;
  }

  return result;
}
