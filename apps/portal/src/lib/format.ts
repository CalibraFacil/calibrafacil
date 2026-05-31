/**
 * Formatting helpers shared across the portal. Centralizes what used to be four
 * copies of `formatDate` and keeps number/currency formatting consistent
 * (always tabular, pt-BR, BRL).
 */

const DATE_SHORT = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const DATE_LONG = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "long",
  year: "numeric",
});

const DATE_TIME = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const CURRENCY = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "12 de mai. de 2026", or "—" when absent/invalid. */
export function formatDate(value: string | Date | null | undefined): string {
  const date = toDate(value);
  return date ? DATE_SHORT.format(date) : "—";
}

/** "12 de maio de 2026". */
export function formatDateLong(
  value: string | Date | null | undefined,
): string {
  const date = toDate(value);
  return date ? DATE_LONG.format(date) : "—";
}

/** "12 de mai. de 2026, 14:30". */
export function formatDateTime(
  value: string | Date | null | undefined,
): string {
  const date = toDate(value);
  return date ? DATE_TIME.format(date) : "—";
}

/** Cents (integer) → "R$ 1.234,56". */
export function formatCurrency(cents: number | null | undefined): string {
  return CURRENCY.format((cents ?? 0) / 100);
}

/** "1 ativo" / "3 ativos". */
export function pluralize(
  count: number,
  singular: string,
  plural: string,
): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
