/**
 * Money text <-> integer cents: the one parser for every typed amount.
 *
 * Pairs with `formatMoney` / `formatMoneyBRL` (format.ts): whatever those
 * print parses back to the same cents, and {@link formatCentsForEditing} is
 * the plain editable form of an amount.
 *
 * No floating point is involved: the text is split into an integer part and a
 * fraction part and joined as a digit string, so "0,29" is exactly 29 cents
 * (not `0.29 * 100 = 28.999...`).
 *
 * Accepted (after trimming whitespace, an optional "R$" prefix and an optional
 * leading "-" that the caller must allow):
 *
 * - pt-BR: "1234", "1234,5", "1234,56", "1.234,56", "1.234.567,89".
 *   The decimal mark is the single comma; dots are thousands separators and
 *   must group exactly three digits ("1.234", never "12.34" or "1.2345").
 * - Unambiguous dot-decimal: "12.50", "12.5", "1234.56". A single dot
 *   followed by exactly one or two digits (and no comma) is a decimal point.
 *
 * Disambiguation of dots, in full:
 *
 * 1. A comma is present: it is the decimal mark (one comma, one or two digits
 *    after it); every dot before it must be a thousands separator. "1,234.56"
 *    is therefore an error, not 1234,56.
 * 2. No comma, exactly one dot followed by one or two digits: decimal point.
 * 3. No comma, dots in groups of exactly three digits after a leading group of
 *    one to three digits not starting with 0: thousands separators ("1.234"
 *    is 1234 reais, "1.234.567" is 1234567 reais).
 * 4. Anything else ("1.234.56", "1.", ".5", ",50", "0.500", "12.3456",
 *    "1 234", "abc") is an error. The parser never answers 0 for input it
 *    cannot read; only a blank string is reported as `empty`, so a caller can
 *    decide that "optional and blank" means "no amount".
 */

export type MoneyParseFailure =
  /** Blank input (nothing but whitespace and, at most, "R$"). */
  | "empty"
  /** Not a number: stray characters, a missing digit group, ",50", "1,". */
  | "malformed"
  /** Readable as two different amounts: "1.234.56", "1,234.56", "0.500". */
  | "ambiguous"
  /** A minus sign where the caller does not allow negative amounts. */
  | "negative"
  /** More than Number.MAX_SAFE_INTEGER cents. */
  | "too_large";

export type MoneyParseResult =
  | { ok: true; cents: number }
  | { ok: false; reason: MoneyParseFailure };

export type ParseMoneyOptions = {
  /** Accept a leading "-" ("-12,50", "-R$ 12,50"). Default false. */
  allowNegative?: boolean;
};

/** Field-error copy (pt-BR) for each failure. */
export const MONEY_PARSE_FAILURE_MESSAGES: Record<MoneyParseFailure, string> = {
  empty: "Informe um valor",
  malformed: "Valor inválido. Use o formato 1.234,56",
  ambiguous: "Valor ambíguo. Use o formato 1.234,56",
  negative: "O valor não pode ser negativo",
  too_large: "Valor muito grande",
};

const THOUSANDS_GROUPED = /^[1-9]\d{0,2}(?:\.\d{3})+$/;
const PLAIN_DIGITS = /^\d+$/;
const COMMA_FRACTION = /^\d{1,2}$/;
const CURRENCY_PREFIX = /^R\$/i;

function fail(reason: MoneyParseFailure): MoneyParseResult {
  return { ok: false, reason };
}

/** Integer digits of the amount text, or the reason they are unreadable. */
function splitAmount(
  body: string,
): { integer: string; fraction: string } | MoneyParseFailure {
  const commaCount = body.split(",").length - 1;

  if (commaCount > 1) return "ambiguous";

  if (commaCount === 1) {
    const [integerText = "", fractionText = ""] = body.split(",");
    if (!COMMA_FRACTION.test(fractionText)) {
      // "1,234.56" (en-US) lands here too: the dot after the comma.
      return fractionText.includes(".") ? "ambiguous" : "malformed";
    }
    if (PLAIN_DIGITS.test(integerText)) {
      return { integer: integerText, fraction: fractionText };
    }
    if (THOUSANDS_GROUPED.test(integerText)) {
      return {
        integer: integerText.replaceAll(".", ""),
        fraction: fractionText,
      };
    }
    return integerText.includes(".") ? "ambiguous" : "malformed";
  }

  if (!body.includes(".")) {
    return PLAIN_DIGITS.test(body)
      ? { integer: body, fraction: "" }
      : "malformed";
  }

  const dotCount = body.split(".").length - 1;
  if (dotCount === 1) {
    const [integerText = "", fractionText = ""] = body.split(".");
    if (PLAIN_DIGITS.test(integerText) && COMMA_FRACTION.test(fractionText)) {
      return { integer: integerText, fraction: fractionText };
    }
  }
  if (THOUSANDS_GROUPED.test(body)) {
    return { integer: body.replaceAll(".", ""), fraction: "" };
  }
  // Digits and dots only, but not a decimal point and not clean thousands.
  return /^[\d.]+$/.test(body) ? "ambiguous" : "malformed";
}

/**
 * Typed money text to integer cents. See the module comment for the accepted
 * forms and the dot disambiguation rule.
 */
export function parseMoneyToCents(
  input: string,
  options: ParseMoneyOptions = {},
): MoneyParseResult {
  let text = input.trim();
  let negative = false;

  // The sign may come before or after the symbol: "-R$ 1,00" (what
  // `formatMoney` prints) or "R$ -1,00".
  if (text.startsWith("-")) {
    negative = true;
    text = text.slice(1).trimStart();
  }
  if (CURRENCY_PREFIX.test(text)) {
    text = text.slice(2).trimStart();
    if (!negative && text.startsWith("-")) {
      negative = true;
      text = text.slice(1).trimStart();
    }
  }

  if (text === "") return fail(negative ? "malformed" : "empty");

  const split = splitAmount(text);
  if (typeof split === "string") return fail(split);

  const cents = Number(
    `${split.integer}${split.fraction.padEnd(2, "0")}`.replace(/^0+(?=\d)/, ""),
  );
  if (!Number.isSafeInteger(cents)) return fail("too_large");

  if (negative && cents !== 0) {
    return options.allowNegative === true
      ? { ok: true, cents: -cents }
      : fail("negative");
  }
  return { ok: true, cents };
}

/**
 * Integer cents as plain editable text: "1234,56" (no symbol, no thousands
 * separators), exact for any safe integer. {@link parseMoneyToCents} reads it
 * back to the same cents. The grouped "R$ 1.234,56" display is
 * `formatMoney`'s job.
 */
export function formatCentsForEditing(cents: number): string {
  if (!Number.isSafeInteger(cents)) return "0,00";
  const digits = String(Math.abs(cents)).padStart(3, "0");
  const sign = cents < 0 ? "-" : "";
  return `${sign}${digits.slice(0, -2)},${digits.slice(-2)}`;
}
