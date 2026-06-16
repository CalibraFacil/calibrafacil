/**
 * CNPJ alfanumérico (Receita Federal, IN RFB nº 2.229/2024, live July 2026).
 *
 * The CNPJ stays 14 characters with the mask `XX.XXX.XXX/XXXX-XX`. Positions 1–12 may be
 * alphanumeric (uppercase A–Z + 0–9); positions 13–14 are the numeric check digits. Legacy
 * fully-numeric CNPJs remain valid forever, so both formats coexist.
 *
 * Check digits use the same módulo-11 algorithm as before, except each base character is
 * converted to `charCodeAt(0) - 48` before weighting: '0'–'9' map to 0–9 unchanged, 'A'=17 …
 * 'Z'=42. Weights cycle 2..9 right-aligned. See the Serpro/Receita Federal technical note.
 */

const CNPJ_LENGTH = 14;
const CNPJ_BASE_LENGTH = 12;

/** Decimal value used by the check-digit algorithm: ASCII code minus 48. */
export function cnpjCharValue(char: string): number {
  return char.charCodeAt(0) - 48;
}

/**
 * Strip mask punctuation/whitespace, uppercase, and drop anything outside `[0-9A-Z]`.
 * Preserves letters (unlike a digits-only strip) so alphanumeric CNPJs survive intact.
 */
export function normalizeCnpj(value: string | null | undefined): string {
  return (value ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
}

/**
 * Compute the two check digits for a 12-character (already normalized) CNPJ base.
 * Returns a 2-character numeric string. Throws if the base is not exactly 12 chars.
 */
export function computeCnpjCheckDigits(base12: string): string {
  if (base12.length !== CNPJ_BASE_LENGTH) {
    throw new Error(
      `computeCnpjCheckDigits expects a 12-char base, received ${base12.length}`,
    );
  }
  const dv1 = checkDigit(base12);
  const dv2 = checkDigit(base12 + String(dv1));
  return `${dv1}${dv2}`;
}

/** One módulo-11 check digit over the given chars; weights cycle 2..9 from the right. */
function checkDigit(chars: string): number {
  let sum = 0;
  for (let i = 0; i < chars.length; i++) {
    const fromRight = chars.length - 1 - i;
    const weight = (fromRight % 8) + 2;
    sum += (chars.charCodeAt(i) - 48) * weight;
  }
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

/**
 * Validate a CNPJ (masked or unmasked, numeric or alphanumeric). Returns false for CPFs and
 * any value that isn't a structurally valid CNPJ with matching check digits.
 */
export function isValidCnpj(value: string | null | undefined): boolean {
  const normalized = normalizeCnpj(value);
  if (normalized.length !== CNPJ_LENGTH) return false;
  // Positions 1–12 alphanumeric, 13–14 numeric check digits.
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(normalized)) return false;
  // Reject placeholder strings like 00000000000000 / AAAAAAAAAAAAAA.
  if (/^(.)\1{13}$/.test(normalized)) return false;
  const base = normalized.slice(0, CNPJ_BASE_LENGTH);
  return computeCnpjCheckDigits(base) === normalized.slice(CNPJ_BASE_LENGTH);
}

/**
 * Format a CNPJ as `XX.XXX.XXX/XXXX-XX` via positional slicing (letter-safe). Inputs that
 * don't normalize to 14 chars are returned normalized but unformatted.
 */
export function formatCnpj(value: string | null | undefined): string {
  const n = normalizeCnpj(value);
  if (n.length !== CNPJ_LENGTH) return n;
  return `${n.slice(0, 2)}.${n.slice(2, 5)}.${n.slice(5, 8)}/${n.slice(8, 12)}-${n.slice(12, 14)}`;
}
