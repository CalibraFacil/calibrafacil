/**
 * The most certificates one audit pack (the customer's bulk export of released
 * certificates) may carry. The API refuses a larger request up front and the
 * worker re-checks it at generation time (the certificate set is re-derived
 * there), so both read this one number.
 */
export const AUDIT_PACK_MAX_CERTIFICATES = 500;

/** The pt-BR refusal both sides show for a period with too many certificates. */
export function auditPackTooLargeMessage(): string {
  return `O período selecionado tem mais de ${AUDIT_PACK_MAX_CERTIFICATES} certificados. Reduza o período e gere pacotes menores.`;
}
