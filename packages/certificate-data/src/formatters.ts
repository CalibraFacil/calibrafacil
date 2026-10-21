import { formatCalendarDate } from "@calibra-facil/shared/format";

export function getPath(data: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (current == null || typeof current !== "object") {
      return undefined;
    }

    return Object.fromEntries(Object.entries(current))[segment];
  }, data);
}

export function formatValue(value: unknown, formatter?: string): string {
  if (value == null) {
    return "";
  }

  if (value instanceof Date) {
    return formatDate(value, formatter);
  }

  if (typeof value === "number") {
    return formatNumber(value, formatter);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "string" && formatter?.startsWith("date:")) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return formatDate(parsed, formatter);
    }
  }

  return String(value);
}

function formatDate(value: Date, formatter?: string): string {
  const style = formatter?.startsWith("date:") ? formatter.slice(5) : formatter;

  if (style === "yyyy-mm-dd") {
    return value.toISOString().slice(0, 10);
  }

  if (style === "dd/mm/yyyy") {
    // The day the value names (a UTC-midnight date column names its UTC day).
    return formatCalendarDate(value, "date");
  }

  return value.toISOString();
}

function formatNumber(value: number, formatter?: string): string {
  if (formatter?.startsWith("number:")) {
    const fractionDigits = Number.parseInt(formatter.slice(7), 10);
    if (Number.isInteger(fractionDigits) && fractionDigits >= 0) {
      return value.toFixed(fractionDigits);
    }
  }

  return String(value);
}
