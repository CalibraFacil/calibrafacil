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
