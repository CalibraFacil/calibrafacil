export type CommercialOfferKind =
  | "SETUP_FEE"
  | "PLAN_UPFRONT"
  | "PLAN_RECURRING";

export type CommercialOfferStatus =
  | "DRAFT"
  | "ISSUED"
  | "PENDING_PAYMENT"
  | "PAID"
  | "ACTIVATED"
  | "EXPIRED"
  | "CANCELED"
  | "SUPERSEDED"
  | "FAILED";

export type CommercialDealStatus =
  | "OPEN"
  | "CLOSED_WON"
  | "CLOSED_LOST"
  | "ARCHIVED";

export type CommercialProvider = "ASAAS";

export type CommercialProviderMode = "CHECKOUT" | "PAYMENT" | "SUBSCRIPTION";

export type CommercialActivationBehavior = "NONE" | "IMMEDIATE_REPLACE";

export type CommercialRenewalMode = "AUTOMATIC" | "MANUAL" | "NONE";

export type CommercialPaymentMethod = "PIX" | "BOLETO" | "CREDIT_CARD";

export type CommercialOfferAccessEventType =
  | "TOKEN_VALIDATED"
  | "TOKEN_INVALID"
  | "TOKEN_REVOKED"
  | "TOKEN_EXPIRED"
  | "TOKEN_TERMINAL"
  | "SNAPSHOT_VIEWED"
  | "PAYMENT_START_REQUESTED"
  | "PAYMENT_STARTED"
  | "PAYMENT_RESUMED"
  | "STATUS_CHECKED"
  | "PROVIDER_REDIRECTED";

export type CommercialPublicCheckoutState =
  | "INVALID"
  | "EXPIRED"
  | "REVOKED"
  | "AWAITING_PAYMENT"
  | "REDIRECTING"
  | "PIX_READY"
  | "BOLETO_READY"
  | "PAID"
  | "OVERDUE"
  | "REFUNDED"
  | "CANCELED";

export type CommercialPublicStartResultType =
  | "PIX_READY"
  | "BOLETO_READY"
  | "REDIRECT"
  | "PAID";

export type CommercialOfferItemType =
  | "PLAN"
  | "SETUP_FEE"
  | "ONBOARDING_FEE"
  | "ADD_ON"
  | "DISCOUNT"
  | "OTHER";

export type BillingCustomerStatus = "ACTIVE" | "ARCHIVED";

export type CommercialHistorySource = "USER" | "SYSTEM" | "WEBHOOK";

export function isPlanBearingOffer(kind: CommercialOfferKind) {
  return kind === "PLAN_UPFRONT" || kind === "PLAN_RECURRING";
}

export function getCommercialRenewalMode(
  kind: CommercialOfferKind,
): CommercialRenewalMode {
  if (kind === "PLAN_RECURRING") return "AUTOMATIC";
  if (kind === "PLAN_UPFRONT") return "MANUAL";
  return "NONE";
}

export function getCommercialOfferLabel(kind: CommercialOfferKind) {
  switch (kind) {
    case "SETUP_FEE":
      return "Taxa de implantacao";
    case "PLAN_UPFRONT":
      return "Plano avista";
    case "PLAN_RECURRING":
      return "Plano recorrente";
  }
}
