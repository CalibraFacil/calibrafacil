export interface CalibrationValueFormatOptions {
  maxFractionDigits?: number;
  significantDigits?: number;
  maxAdaptiveFractionDigits?: number;
  decimalSeparator?: "." | ",";
  wrapArrays?: boolean;
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
  return options.decimalSeparator === ","
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
      .join(", ");
    return options.wrapArrays ? `[${formatted}]` : formatted;
  }

  if (isNumericValue(value)) {
    return formatCalibrationNumber(value, options);
  }

  return String(value);
}
