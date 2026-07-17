/**
 * Named, deterministic formatters for placeholder values (spec 02 §2).
 *
 * Determinism rule: NO Intl/locale APIs — their output can differ between
 * runtimes (Node vs Bun) and ICU versions, which would break the
 * compiled-HTML sha256 guarantee. Everything is formatted by hand.
 */

export type PlaceholderFormat = "text" | "date-br" | "number-br" | "cnpj" | "bool-br";

export class PlaceholderFormatError extends Error {
  constructor(format: PlaceholderFormat, value: unknown) {
    super(
      `cannot apply format "${format}" to value ${JSON.stringify(value)} (${typeof value})`,
    );
    this.name = "PlaceholderFormatError";
  }
}

/** ISO date/datetime -> dd/mm/yyyy, using the DATE PART only (TZ-safe). */
function formatDateBr(value: unknown): string {
  if (value instanceof Date) {
    return formatDateBr(value.toISOString());
  }
  if (typeof value === "string") {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  }
  throw new PlaceholderFormatError("date-br", value);
}

/** Number -> pt-BR convention: "." thousands, "," decimal. Hand-rolled. */
function formatNumberBr(value: unknown): string {
  const num =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))
        ? Number(value)
        : undefined;
  if (num === undefined || !Number.isFinite(num)) {
    throw new PlaceholderFormatError("number-br", value);
  }
  const sign = num < 0 ? "-" : "";
  const [intPart = "0", fracPart] = Math.abs(num).toString().split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return fracPart ? `${sign}${grouped},${fracPart}` : `${sign}${grouped}`;
}

/**
 * CNPJ mask: XX.XXX.XXX/XXXX-XX over 14 alphanumeric characters.
 * IMPORTANT: since July 2026 new CNPJs are ALPHANUMERIC (RFB IN 2.229/2024) —
 * positions 1-12 may be letters; only the check digits are numeric. So this
 * must NOT strip to digits; it strips separators only and masks positionally.
 */
function formatCnpj(value: unknown): string {
  if (typeof value !== "string") throw new PlaceholderFormatError("cnpj", value);
  const chars = value.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  if (chars.length !== 14) return value; // leave unusual identifiers untouched
  return `${chars.slice(0, 2)}.${chars.slice(2, 5)}.${chars.slice(5, 8)}/${chars.slice(8, 12)}-${chars.slice(12, 14)}`;
}

function formatBoolBr(value: unknown): string {
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  throw new PlaceholderFormatError("bool-br", value);
}

function formatText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new PlaceholderFormatError("text", value);
    return formatNumberBr(value);
  }
  if (typeof value === "boolean") return formatBoolBr(value);
  throw new PlaceholderFormatError("text", value);
}

export function applyPlaceholderFormat(
  format: PlaceholderFormat,
  value: unknown,
): string {
  switch (format) {
    case "date-br":
      return formatDateBr(value);
    case "number-br":
      return formatNumberBr(value);
    case "cnpj":
      return formatCnpj(value);
    case "bool-br":
      return formatBoolBr(value);
    case "text":
      return formatText(value);
  }
}
