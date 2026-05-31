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

// =============================================================================
// CERTIFICATE RELEASE — Phase 2 slice 1. Separates technical certificate
// approval (calibrationJob.status === "APPROVED") from commercial release
// to the customer portal. Provider-neutral.
// =============================================================================

/**
 * Commercial release state for a calibration job's certificate.
 *
 * - HELD_FOR_BILLING:   policy mode is satisfied by an invoice but the
 *                       billing document has not been issued yet.
 * - HELD_FOR_PAYMENT:   billing document exists; policy waits on payment
 *                       evidence that has not arrived.
 * - RELEASED:           policy is satisfied (or `manual_only` /
 *                       `trusted_customer`); customer portal can download.
 * - RELEASED_BY_EXCEPTION: human override; recorded actor + reason.
 */
export type CertificateReleaseStatus =
  | "HELD_FOR_BILLING"
  | "HELD_FOR_PAYMENT"
  | "RELEASED"
  | "RELEASED_BY_EXCEPTION";

/**
 * Release policy modes. The strategy's
 * "Partial Payments Or Installments" section enumerates these.
 */
export type CertificateReleasePolicyMode =
  | "release_after_invoice"
  | "release_after_first_installment"
  | "release_after_full_payment"
  | "trusted_customer"
  | "manual_only";

/**
 * Reason the release-state recompute / mutation happened. Audit-only.
 */
export type CertificateReleaseAuditSource =
  | "system_reconciliation"
  | "manual_release"
  | "exception_release"
  | "policy_change"
  | "backfill";

// Phase 2 slice 4 — automatic send rules by milestone.
// Provider-neutral. Rules say: "when MILESTONE fires for a service
// order whose policy points at me, send it to the configured financial
// provider." Triggered automatically by the engine; audited.

export type AutomaticSendMilestone =
  | "certificate_approved"
  | "service_order_delivered"
  | "contract_anniversary"
  | "manual_only";

export type AutomaticSendOutcome =
  | "sent"
  | "skipped_already_sent"
  | "skipped_blocked"
  | "skipped_manual_only"
  | "skipped_milestone_not_matched"
  | "failed";

// Phase 2 slice 7 — supplier and transporter records, normalized from
// the free-text supplierName captured in slice 6.

export type SupplierKind =
  | "outsourced_lab"
  | "transporter"
  | "both"
  | "other";

// Phase 2 slice 9 — batch / consolidated billing groups.

export type BillingGroupStatus = "OPEN" | "CLOSED" | "VOID";

/**
 * Snapshot of the financial state at the moment the certificate release was
 * last evaluated. Frozen so audit history reads do not need to re-query.
 * Provider-neutral by construction (`continuityStatus` is the shared enum).
 */
export interface CertificateReleasePaymentStateSnapshot {
  continuityStatus: FinancialContinuityStatus | null;
  openCents: number;
  overdueCents: number;
  installments: Array<{
    id: number;
    status: ReceivableInstallmentStatus;
    dueDate: string | null;
  }>;
  billingDocument: {
    id: number;
    status: BillingDocumentStatus;
    exportStatus: BillingDocumentExportStatus;
    issuedAt: string | null;
  } | null;
}

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

// =============================================================================
// BILLING READINESS — provider-neutral "ready for billing" / revenue-leakage
// queue. Lab-facing concepts only; provider mechanics stay in the adapter.
// =============================================================================

/**
 * Where a completed unit of work sits on its way to becoming billed revenue.
 * - READY:   billable, no blockers, no billing document yet.
 * - BLOCKED: billable milestone reached but something prevents billing.
 * - BILLED:  a billing document exists but has not been sent to finance yet.
 * - SENT:    the billing document was sent to the financial provider.
 */
export type BillingReadinessStatus = "READY" | "BLOCKED" | "BILLED" | "SENT";

/** Who is responsible for resolving a billing blocker. */
export type BillingBlockerOwner =
  | "lab_ops"
  | "finance"
  | "commercial"
  | "admin"
  | "support";

/** How far a blocker reaches: one order, one customer, or all future work. */
export type BillingBlockerScope = "order" | "customer" | "all_future";

/**
 * Provider-neutral blocker codes from the strategy's failure/blocking model.
 * These describe lab-side problems, never raw provider error enums.
 */
export type BillingBlockerCode =
  | "BLOCKED_BY_CUSTOMER_DATA"
  | "BLOCKED_BY_UNMAPPED_SERVICE"
  | "BLOCKED_BY_CERTIFICATE_STATUS"
  | "BLOCKED_BY_POLICY"
  | "INTEGRATION_NOT_CONFIGURED"
  | "INTEGRATION_DISCONNECTED"
  | "CONFIGURATION_INCOMPLETE";

export interface BillingBlocker {
  code: BillingBlockerCode;
  /** Human-readable, lab-facing explanation of the blocker. */
  label: string;
  owner: BillingBlockerOwner;
  /** Suggested next step to clear the blocker. */
  fixAction: string;
  scope: BillingBlockerScope;
}

export function getBillingReadinessStatusLabel(status: BillingReadinessStatus) {
  switch (status) {
    case "READY":
      return "Pronto para faturar";
    case "BLOCKED":
      return "Bloqueado";
    case "BILLED":
      return "Faturado";
    case "SENT":
      return "Enviado para o financeiro";
  }
}

export function getBillingBlockerOwnerLabel(owner: BillingBlockerOwner) {
  switch (owner) {
    case "lab_ops":
      return "Operação";
    case "finance":
      return "Financeiro";
    case "commercial":
      return "Comercial";
    case "admin":
      return "Administrador";
    case "support":
      return "Suporte";
  }
}

/** Whether the org has a usable financial provider connection. */
export type BillingIntegrationState =
  | "connected"
  | "disconnected"
  | "not_configured";

export interface BillingReadinessCertificateRef {
  jobId: number;
  /** Human-readable certificate/job number. */
  displayId: string;
  status: string;
}

/** One completed service order on its way to billed revenue. */
export interface BillingReadinessItem {
  serviceOrderId: number;
  serviceOrderNumber: string;
  customer: { id: number; name: string };
  unit: { id: number; name: string };
  amountCents: number;
  currency: string;
  /** ISO timestamp of operational completion, when known. */
  completedAt: string | null;
  certificateRefs: BillingReadinessCertificateRef[];
  readinessStatus: BillingReadinessStatus;
  blockers: BillingBlocker[];
  existingBillingDocumentId: number | null;
}

export interface BillingReadinessSummary {
  ready: number;
  blocked: number;
  billed: number;
  sent: number;
}

// =============================================================================
// FINANCIAL CONTINUITY READ MODEL — provider-neutral operational status.
// =============================================================================

export type FinancialContinuityStatus =
  | "NOT_CONFIGURED"
  | "NOT_SENT"
  | "READY_FOR_BILLING"
  | "BLOCKED"
  | "SENT_TO_FINANCE"
  | "INVOICE_AVAILABLE"
  | "AWAITING_PAYMENT"
  | "PARTIALLY_PAID"
  | "PAID"
  | "OVERDUE"
  | "STATUS_UNAVAILABLE"
  | "SYNCHRONIZED_WITH_WARNINGS"
  | "VOID";

export type FiscalDocumentAvailability =
  | "NONE"
  | "PENDING"
  | "AVAILABLE"
  | "UNAVAILABLE"
  | "WARNINGS";

export interface FinancialFreshness {
  status: "fresh" | "stale" | "unknown" | "local_only";
  lastSyncedAt: string | null;
  label: string;
}

export interface FinancialProviderEvidence {
  label: string;
  integrationState: BillingIntegrationState;
  reconnectPath: string | null;
}

export interface FinancialFiscalDocument {
  availability: FiscalDocumentAvailability;
  label: string;
  number: string | null;
  issuedAt: string | null;
  accessKey: string | null;
  // Durable read-model fields for future NF-e XML download and consult-only UI.
  xmlAvailable: boolean;
  consultationOnly: boolean;
  lastSyncedAt: string | null;
}

export type FiscalDocumentView = FinancialFiscalDocument;

export interface FinancialInstallmentStatus {
  id: number;
  installmentNumber: number;
  status: ReceivableInstallmentStatus;
  label: string;
  amountCents: number;
  currency: string;
  dueDate: string;
  paidAt: string | null;
  paymentMethod: FinancialPaymentMethod | null;
}

export type ReceivableInstallmentView = FinancialInstallmentStatus;

// Phase 2 slice 2 — installments + partial-payment lab surface.
// Provider-neutral summary that the lab UI consumes to render
// "N de M pagas · R$ X em aberto · R$ Y em atraso" chips without
// recomputing on every render.

export interface FinancialInstallmentsSummary {
  total: number;
  totalCents: number;
  paidCents: number;
  openCents: number;
  overdueCents: number;
  paidCount: number;
  openCount: number;
  overdueCount: number;
  voidCount: number;
}

const EMPTY_INSTALLMENTS_SUMMARY: FinancialInstallmentsSummary = {
  total: 0,
  totalCents: 0,
  paidCents: 0,
  openCents: 0,
  overdueCents: 0,
  paidCount: 0,
  openCount: 0,
  overdueCount: 0,
  voidCount: 0,
};

/**
 * Aggregate installment counts + amounts for the lab surface. VOID
 * installments are kept in the per-row list (so operators can reconcile
 * against ERP cancellations) but excluded from totals + counts —
 * matching how the rest of the read model treats VOID rows.
 */
export function summarizeInstallments(
  installments: ReadonlyArray<
    Pick<FinancialInstallmentStatus, "status" | "amountCents">
  >,
): FinancialInstallmentsSummary {
  if (installments.length === 0) return { ...EMPTY_INSTALLMENTS_SUMMARY };

  const summary: FinancialInstallmentsSummary = { ...EMPTY_INSTALLMENTS_SUMMARY };
  summary.total = installments.length;

  for (const installment of installments) {
    if (installment.status === "VOID") {
      summary.voidCount += 1;
      continue;
    }
    summary.totalCents += installment.amountCents;
    if (installment.status === "PAID") {
      summary.paidCents += installment.amountCents;
      summary.paidCount += 1;
    } else if (installment.status === "OVERDUE") {
      summary.openCents += installment.amountCents;
      summary.overdueCents += installment.amountCents;
      summary.overdueCount += 1;
    } else if (installment.status === "OPEN") {
      summary.openCents += installment.amountCents;
      summary.openCount += 1;
    }
  }

  return summary;
}

export interface FinancialReceiptStatus {
  id: number;
  installmentId: number;
  receivedAt: string;
  amountCents: number;
  paymentMethod: FinancialPaymentMethod;
  reference: string | null;
}

export type PaymentReceiptView = FinancialReceiptStatus;

export interface ServiceOrderFinancialStatus {
  serviceOrderId: number;
  serviceOrderNumber: string;
  status: FinancialContinuityStatus;
  label: string;
  description: string;
  readinessStatus: BillingReadinessStatus | null;
  blockers: BillingBlocker[];
  amountCents: number;
  currency: string;
  billingDocument: {
    id: number;
    documentNumber: string | null;
    status: BillingDocumentStatus;
    exportStatus: BillingDocumentExportStatus;
    issuedAt: string | null;
    dueDate: string;
    totalCents: number;
    currency: string;
  } | null;
  installments: FinancialInstallmentStatus[];
  installmentsSummary: FinancialInstallmentsSummary;
  receipts: FinancialReceiptStatus[];
  fiscalDocument: FinancialFiscalDocument;
  freshness: FinancialFreshness;
  providerEvidence: FinancialProviderEvidence | null;
}

export interface CustomerFinancialTimelineDocument {
  id: number;
  documentNumber: string | null;
  status: BillingDocumentStatus;
  exportStatus: BillingDocumentExportStatus;
  continuityStatus: FinancialContinuityStatus;
  label: string;
  issueDate: string | null;
  dueDate: string;
  totalCents: number;
  currency: string;
  unit: { id: number; name: string };
  installments: FinancialInstallmentStatus[];
  receipts: FinancialReceiptStatus[];
  fiscalDocuments: FinancialFiscalDocument[];
  freshness: FinancialFreshness;
  providerEvidence: FinancialProviderEvidence | null;
}

export interface CustomerFinancialTimeline {
  customerId: number;
  freshness: FinancialFreshness;
  summary: {
    scope: "recent_documents";
    scopeLabel: string;
    limit: number;
    isTruncated: boolean;
    documents: number;
    totalDocuments: number;
    openCents: number;
    overdueCents: number;
    receivedCents: number;
  };
  data: CustomerFinancialTimelineDocument[];
}

export interface FinancialContinuitySummary {
  openCents: number;
  overdueCents: number;
  receivedCents: number;
  documents: number;
}

export interface FinancialContinuityStatusInput {
  hasBillingDocument: boolean;
  billingDocumentStatus?: BillingDocumentStatus | null;
  exportStatus?: BillingDocumentExportStatus | null;
  installmentStatuses?: ReceivableInstallmentStatus[];
  blockers?: BillingBlocker[];
  isStale?: boolean;
  isConfigured?: boolean;
}

export type DeriveFinancialContinuityInput = FinancialContinuityStatusInput;

export const FINANCIAL_FRESHNESS_STALE_AFTER_HOURS = 24;

export function getReceivableInstallmentStatusLabel(
  status: ReceivableInstallmentStatus,
) {
  switch (status) {
    case "OPEN":
      return "Aguardando pagamento";
    case "PAID":
      return "Pago";
    case "OVERDUE":
      return "Em atraso";
    case "VOID":
      return "Anulado";
  }
}

export function getFinancialContinuityStatusLabel(
  status: FinancialContinuityStatus,
) {
  switch (status) {
    case "NOT_CONFIGURED":
      return "Status local";
    case "NOT_SENT":
      return "Ainda não enviado";
    case "READY_FOR_BILLING":
      return "Pronto para faturar";
    case "BLOCKED":
      return "Bloqueado para faturamento";
    case "SENT_TO_FINANCE":
      return "Enviado para o financeiro";
    case "INVOICE_AVAILABLE":
      return "Faturado";
    case "AWAITING_PAYMENT":
      return "Aguardando confirmação de pagamento";
    case "PARTIALLY_PAID":
      return "Pagamento parcial";
    case "PAID":
      return "Pago";
    case "OVERDUE":
      return "Em atraso";
    case "VOID":
      return "Anulado";
    case "STATUS_UNAVAILABLE":
      return "Status indisponível";
    case "SYNCHRONIZED_WITH_WARNINGS":
      return "Sincronizado com avisos";
  }
}

export function deriveFinancialContinuityStatus(
  input: FinancialContinuityStatusInput,
): FinancialContinuityStatus {
  if (input.isConfigured === false && !input.hasBillingDocument) {
    return "NOT_CONFIGURED";
  }

  const blockers = input.blockers ?? [];
  if (!input.hasBillingDocument) {
    if (input.isStale) return "STATUS_UNAVAILABLE";
    return blockers.length > 0 ? "BLOCKED" : "READY_FOR_BILLING";
  }

  if (input.billingDocumentStatus === "VOID") return "VOID";
  if (input.billingDocumentStatus === "PAID") return "PAID";
  if (input.billingDocumentStatus === "OVERDUE") return "OVERDUE";

  const installmentStatuses = input.installmentStatuses ?? [];
  if (installmentStatuses.length > 0) {
    const activeStatuses = installmentStatuses.filter(
      (status) => status !== "VOID",
    );
    if (activeStatuses.length === 0) return "VOID";
    if (activeStatuses.every((status) => status === "PAID")) return "PAID";
    if (activeStatuses.some((status) => status === "OVERDUE")) {
      return "OVERDUE";
    }
    if (input.isStale) return "STATUS_UNAVAILABLE";
    if (activeStatuses.some((status) => status === "PAID")) {
      return "PARTIALLY_PAID";
    }
    return "AWAITING_PAYMENT";
  }

  if (input.isStale) return "STATUS_UNAVAILABLE";
  if (input.exportStatus === "FAILED") return "SYNCHRONIZED_WITH_WARNINGS";
  if (input.exportStatus === "EXPORTED") {
    return input.billingDocumentStatus === "ISSUED"
      ? "INVOICE_AVAILABLE"
      : "SENT_TO_FINANCE";
  }
  return "NOT_SENT";
}

export function buildFinancialFreshness(input: {
  hasProviderEvidence?: boolean;
  integrationState?: BillingIntegrationState;
  lastSyncedAt: string | null;
  now?: Date;
  staleAfterHours?: number;
}): FinancialFreshness {
  const hasProviderEvidence =
    input.hasProviderEvidence ??
    (input.integrationState !== undefined &&
      input.integrationState !== "not_configured");

  if (!hasProviderEvidence) {
    return {
      status: "local_only",
      lastSyncedAt: null,
      label: "Status local",
    };
  }

  if (!input.lastSyncedAt) {
    return {
      status: "unknown",
      lastSyncedAt: null,
      label: "Status indisponível",
    };
  }

  const syncedAt = new Date(input.lastSyncedAt);
  const now = input.now ?? new Date();
  const staleAfterMs =
    (input.staleAfterHours ?? FINANCIAL_FRESHNESS_STALE_AFTER_HOURS) *
    60 *
    60 *
    1000;
  const stale =
    Number.isNaN(syncedAt.getTime()) ||
    now.getTime() - syncedAt.getTime() > staleAfterMs;

  return {
    status: stale ? "stale" : "fresh",
    lastSyncedAt: input.lastSyncedAt,
    label: stale ? "Sincronizado com avisos" : "Sincronizado",
  };
}

export function getFinancialContinuityStatusDescription(
  status: FinancialContinuityStatus,
) {
  switch (status) {
    case "NOT_CONFIGURED":
      return "Sem integração financeira ativa. O acompanhamento usa apenas dados locais.";
    case "NOT_SENT":
      return "Documento financeiro ainda não enviado.";
    case "READY_FOR_BILLING":
      return "A OS já pode seguir para faturamento.";
    case "BLOCKED":
      return "Existe um bloqueio que impede o faturamento.";
    case "SENT_TO_FINANCE":
      return "Aguardando confirmação financeira.";
    case "INVOICE_AVAILABLE":
      return "Documento financeiro disponível.";
    case "AWAITING_PAYMENT":
      return "Aguardando confirmação de pagamento.";
    case "PARTIALLY_PAID":
      return "Há recebimentos parciais registrados.";
    case "PAID":
      return "Pagamento confirmado.";
    case "OVERDUE":
      return "Há parcelas vencidas.";
    case "STATUS_UNAVAILABLE":
      return "O status financeiro não pôde ser confirmado recentemente.";
    case "SYNCHRONIZED_WITH_WARNINGS":
      return "O status foi sincronizado, mas há avisos que precisam de atenção.";
    case "VOID":
      return "Documento financeiro cancelado.";
  }
}

export function getFiscalDocumentAvailabilityLabel(
  availability: FiscalDocumentAvailability,
) {
  switch (availability) {
    case "NONE":
      return "Sem documento fiscal vinculado";
    case "PENDING":
      return "Configuração fiscal pendente";
    case "AVAILABLE":
      return "Documento fiscal disponível";
    case "UNAVAILABLE":
      return "Consulta fiscal indisponível";
    case "WARNINGS":
      return "Documento fiscal com avisos";
  }
}

/** Default lab-facing label for each blocker code. */
export function getBillingBlockerCodeLabel(code: BillingBlockerCode) {
  switch (code) {
    case "BLOCKED_BY_CUSTOMER_DATA":
      return "Dados de faturamento do cliente incompletos";
    case "BLOCKED_BY_UNMAPPED_SERVICE":
      return "Serviço sem preço ou mapeamento";
    case "BLOCKED_BY_CERTIFICATE_STATUS":
      return "Certificado ainda não aprovado";
    case "BLOCKED_BY_POLICY":
      return "Bloqueado por política comercial";
    case "INTEGRATION_NOT_CONFIGURED":
      return "Integração financeira não configurada";
    case "INTEGRATION_DISCONNECTED":
      return "Integração financeira desconectada";
    case "CONFIGURATION_INCOMPLETE":
      return "Configuração da integração incompleta";
  }
}

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
