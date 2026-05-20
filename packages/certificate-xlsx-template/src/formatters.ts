export function getPath(data: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (current == null || typeof current !== "object") {
      return undefined;
    }

    return (current as Record<string, unknown>)[segment];
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
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "UTC",
    }).format(value);
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
