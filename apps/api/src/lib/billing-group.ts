export interface BillingGroupCandidateInput {
  serviceOrderId: number;
  customerId: number;
  paymentTermDays: number;
  currency: string;
  /** ISO date string for the SO's billing-relevant timestamp (delivered / ready). */
  billingReferenceDate: string | null;
}

export interface BillingGroupCompatibilityResult {
  compatible: boolean;
  reasons: string[];
}

/**
 * Pure compatibility check over the SO inputs that would be grouped
 * into one billing document. The lab UI calls this before persisting
 * a group; failure surfaces every reason so operators can fix or
 * exclude the offending SO.
 *
 * Compatibility rules (provider-neutral pt-BR strings):
 *  - All SOs must belong to the same customer.
 *  - All SOs must share the same payment term (days).
 *  - All SOs must share the same currency.
 *  - When `billingReferenceDate` is non-null for all, the spread must
 *    fit inside a 31-day window (one billing period).
 */
export function evaluateBillingGroupCompatibility(
  inputs: ReadonlyArray<BillingGroupCandidateInput>,
): BillingGroupCompatibilityResult {
  const reasons: string[] = [];

  if (inputs.length === 0) {
    return { compatible: false, reasons: ["Nenhuma OS informada"] };
  }
  if (inputs.length === 1) {
    return { compatible: true, reasons: [] };
  }

  const customerIds = new Set(inputs.map((row) => row.customerId));
  if (customerIds.size > 1) {
    reasons.push("As OS pertencem a clientes diferentes");
  }

  const paymentTerms = new Set(inputs.map((row) => row.paymentTermDays));
  if (paymentTerms.size > 1) {
    reasons.push("As OS têm prazos de pagamento diferentes");
  }

  const currencies = new Set(inputs.map((row) => row.currency));
  if (currencies.size > 1) {
    reasons.push("As OS têm moedas diferentes");
  }

  const dates = inputs
    .map((row) =>
      row.billingReferenceDate ? new Date(row.billingReferenceDate) : null,
    )
    .filter((date): date is Date => date !== null && !Number.isNaN(date.getTime()));
  if (dates.length === inputs.length && dates.length > 1) {
    const sorted = dates.slice().sort((a, b) => a.getTime() - b.getTime());
    const spread = sorted[sorted.length - 1]!.getTime() - sorted[0]!.getTime();
    const days = spread / (24 * 60 * 60 * 1000);
    if (days > 31) {
      reasons.push(
        "As OS estão fora do mesmo período de faturamento (intervalo > 31 dias)",
      );
    }
  }

  return { compatible: reasons.length === 0, reasons };
}
