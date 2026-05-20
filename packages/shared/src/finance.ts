export type CommercialAgreementStatus =
  | "DRAFT"
  | "ACTIVE"
  | "EXPIRED"
  | "CANCELED";

export type JobCommercialSnapshotSource =
  | "AGREEMENT"
  | "SERVICE_CATALOG"
  | "LEGACY_BACKFILL";

export type BillingDocumentStatus =
  | "DRAFT"
  | "ISSUED"
  | "PAID"
  | "OVERDUE"
  | "VOID";

export type BillingDocumentExportStatus =
  | "NOT_EXPORTED"
  | "PENDING"
  | "EXPORTED"
  | "FAILED";

export type ReceivableInstallmentStatus = "OPEN" | "PAID" | "OVERDUE" | "VOID";

export type FinancialPaymentMethod =
  | "CREDIT_CARD"
  | "PIX"
  | "BOLETO"
  | "BANK_TRANSFER"
  | "CASH"
  | "OTHER";

export type FinancialStatus =
  | "UNBILLED"
  | "DRAFT"
  | "ISSUED"
  | "PAID"
  | "OVERDUE"
  | "VOID";

export const DEFAULT_FINANCIAL_PAYMENT_TERM_DAYS = 28;

export function formatMoney(cents: number, currency = "BRL") {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

export function calculateFinancialDueDate(
  issueDate: Date,
  paymentTermDays = DEFAULT_FINANCIAL_PAYMENT_TERM_DAYS,
) {
  const dueDate = new Date(issueDate);
  dueDate.setDate(dueDate.getDate() + paymentTermDays);
  return dueDate;
}

export function getFinancialStatusLabel(status: FinancialStatus) {
  switch (status) {
    case "UNBILLED":
      return "Nao faturado";
    case "DRAFT":
      return "Rascunho";
    case "ISSUED":
      return "Emitido";
    case "PAID":
      return "Recebido";
    case "OVERDUE":
      return "Vencido";
    case "VOID":
      return "Anulado";
  }
}

export function getBillingDocumentStatusLabel(status: BillingDocumentStatus) {
  switch (status) {
    case "DRAFT":
      return "Rascunho";
    case "ISSUED":
      return "Emitido";
    case "PAID":
      return "Recebido";
    case "OVERDUE":
      return "Vencido";
    case "VOID":
      return "Anulado";
  }
}

export function getCommercialAgreementStatusLabel(
  status: CommercialAgreementStatus,
) {
  switch (status) {
    case "DRAFT":
      return "Rascunho";
    case "ACTIVE":
      return "Ativo";
    case "EXPIRED":
      return "Expirado";
    case "CANCELED":
      return "Cancelado";
  }
}
