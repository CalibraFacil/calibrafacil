/**
 * Portal formatting helpers now live in @calibra-facil/shared/format — this
 * re-export keeps the portal's `@/lib/format` import path stable.
 */
export {
  formatCurrency,
  formatDate,
  formatDateLong,
  formatDateTime,
  pluralize,
} from "@calibra-facil/shared/format";

import { formatDateOnly as formatStoredDay } from "@calibra-facil/documents";

/**
 * Date-only values (a due day, a visit day) are typed into a date field and
 * stored at UTC midnight, which {@link formatDate} would show as the evening
 * before in Brazil. These name the stored day: "12 de mai. de 2026".
 */
export function formatDateOnly(value: string | Date | null | undefined) {
  return formatStoredDay(value, "—", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** "12 de maio de 2026", for a stored date-only value. */
export function formatDateOnlyLong(value: string | Date | null | undefined) {
  return formatStoredDay(value, "—", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}
