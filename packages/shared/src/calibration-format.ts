export interface CalibrationValueFormatOptions {
  maxFractionDigits?: number;
  significantDigits?: number;
  maxAdaptiveFractionDigits?: number;
  /**
   * Default "," (pt-BR, Q47; roadmap 2 F3): measurement values read as in the
   * certificate. "." only where a machine reads the text.
   */
  decimalSeparator?: "." | ",";
  wrapArrays?: boolean;
}

/**
 * Parse a measurement typed by a person (roadmap 2 F3): one decimal separator,
 * comma (pt-BR) or point, an optional sign and exponent, no thousands grouping
 * ("1.234,5" is refused: ambiguous for a reading). Null when it is not a number.
 */
export function parseMeasurementInput(text: string): number | null {
  const trimmed = text.trim();
  if (!/^[+-]?(?:\d+[.,]?\d*|[.,]\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) {
    return null;
  }
  const parsed = Number(trimmed.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Whether `text` can still become a measurement while it is being typed. */
export function isPartialMeasurementInput(text: string): boolean {
  return /^-?\d*[.,]?\d*$/.test(text);
}

/** A machine-formatted number ("12.5", "-0.003") with the pt-BR decimal comma. */
export function withDecimalComma(text: string): string {
  return text.replace(".", ",");
}

const NUMERIC_STRING_PATTERN =
  /^[+-]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:e[+-]?\d+)?$/i;

function isNumericValue(value: unknown): value is number | string {
  if (typeof value === "number") return Number.isFinite(value);
  return typeof value === "string" && NUMERIC_STRING_PATTERN.test(value.trim());
}

function trimTrailingZeros(value: string): string {
  if (!value.includes(".")) return value;
  return value.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
}

export function formatCalibrationNumber(
  value: number | string,
  options: CalibrationValueFormatOptions = {},
): string {
  const numericValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numericValue)) return String(value);

  const maxFractionDigits = options.maxFractionDigits ?? 6;
  const significantDigits = options.significantDigits ?? 6;
  const maxAdaptiveFractionDigits = options.maxAdaptiveFractionDigits ?? 12;
  const abs = Math.abs(numericValue);

  if (abs === 0) return "0";

  let fractionDigits = maxFractionDigits;
  if (abs < 10 ** -maxFractionDigits) {
    fractionDigits = Math.min(
      maxAdaptiveFractionDigits,
      Math.ceil(-Math.log10(abs)) + significantDigits - 1,
    );
  }

  const formatted = trimTrailingZeros(numericValue.toFixed(fractionDigits));
  return (options.decimalSeparator ?? ",") === ","
    ? formatted.replace(".", ",")
    : formatted;
}

export function formatCalibrationValue(
  value: unknown,
  options: CalibrationValueFormatOptions = {},
): string {
  if (value === null || value === undefined || value === "") return "-";

  if (Array.isArray(value)) {
    const formatted = value
      .map((item) => formatCalibrationValue(item, options))
      // With the decimal comma, "; " keeps "1,5; 2,3" readable as two values.
      .join((options.decimalSeparator ?? ",") === "," ? "; " : ", ");
    return options.wrapArrays ? `[${formatted}]` : formatted;
  }

  if (isNumericValue(value)) {
    return formatCalibrationNumber(value, options);
  }

  return String(value);
}
