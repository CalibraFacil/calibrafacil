import {
  deriveFinancialContinuityStatus,
  type FinancialContinuityStatus,
  type FinancialFreshness,
  type ServiceOrderFinancialStatus,
} from "@calibra-facil/shared";
import { db } from "@calibra-facil/db";
import { integrationObjectLink } from "@calibra-facil/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { buildServiceOrderFinancialStatus } from "./financial-timeline";
import type { buildUnitScopeCondition } from "./units";

type PortalFinancialScope = Parameters<typeof buildUnitScopeCondition>[1];

export type PortalServiceOrderFinancialSummaryState =
  | "INVOICE_AVAILABLE"
  | "PAYMENT_PENDING"
  | "PAID"
  | "OVERDUE";

export interface PortalServiceOrderFinancialSummary {
  state: PortalServiceOrderFinancialSummaryState | null;
  visible: boolean;
  dueDate: string | null;
  paidAt: string | null;
  openAmountCents: number;
  overdueAmountCents: number;
  lastUpdatedAt: string | null;
  freshness: Extract<
    FinancialFreshness["status"],
    "fresh" | "stale" | "unknown"
  >;
  documents: Array<{
    kind: "invoice" | "fiscal_document" | "receipt";
    label: string;
    availableAt: string | null;
    href: string | null;
  }>;
}

const hiddenSummary: PortalServiceOrderFinancialSummary = {
  state: null,
  visible: false,
  dueDate: null,
  paidAt: null,
  openAmountCents: 0,
  overdueAmountCents: 0,
  lastUpdatedAt: null,
  freshness: "unknown",
  documents: [],
};

type PortalFinancialDocumentHrefMap = {
  invoice?: string | null;
  fiscalDocument?: string | null;
  receipts?: Record<number, string | null>;
};

type PortalFinancialDocumentRow =
  PortalServiceOrderFinancialSummary["documents"][number];

export type PortalFinancialDocumentHrefSigner = (
  r2Key: string,
) => Promise<string>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function recordValue(value: unknown) {
  return isRecord(value) ? value : null;
}

function localArtifactR2Key(metadata: Record<string, unknown> | null) {
  if (!metadata) return null;

  const direct =
    textValue(metadata.r2Key) ??
    textValue(metadata.pdfR2Key) ??
    textValue(metadata.xmlR2Key);
  if (direct) return direct;

  const artifact = recordValue(metadata.localArtifact);
  return artifact
    ? (textValue(artifact.r2Key) ??
        textValue(artifact.pdfR2Key) ??
        textValue(artifact.xmlR2Key))
    : null;
}

function isAvailableLocalArtifact(metadata: Record<string, unknown> | null) {
  if (!metadata) return false;
  const status = textValue(metadata.status);
  const r2Key = localArtifactR2Key(metadata);
  return Boolean(
    r2Key && !r2Key.startsWith("pending/") && status !== "unavailable",
  );
}

function addDocumentRow(
  rows: PortalServiceOrderFinancialSummary["documents"],
  row: PortalFinancialDocumentRow,
) {
  if (row.href || row.availableAt) {
    rows.push(row);
  }
}

function fiscalRemoteDocumentCandidates(accessKey: string | null) {
  return accessKey
    ? [
        `nfe:${accessKey}:xml`,
        `nfse:${accessKey}:xml`,
        `mdfe:${accessKey}:xml`,
        `mdfe_link:${accessKey}:xml`,
      ]
    : [];
}

function receiptRemoteDocumentCandidates(receiptIds: number[]) {
  return receiptIds.flatMap((receiptId) => [
    `receipt:${receiptId}:pdf`,
    `payment_receipt:${receiptId}:pdf`,
  ]);
}

function getReceiptIdFromRemoteDocumentLocalId(localEntityId: string) {
  const [prefix, receiptId, suffix] = localEntityId.split(":");
  if (
    suffix !== "pdf" ||
    (prefix !== "receipt" && prefix !== "payment_receipt") ||
    !receiptId ||
    !/^\d+$/.test(receiptId)
  ) {
    return null;
  }

  const parsed = Number.parseInt(receiptId, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function getRemoteDocumentKind(metadata: Record<string, unknown> | null) {
  return metadata ? textValue(metadata.documentKind) : null;
}

async function signRemoteDocumentLink(
  metadata: Record<string, unknown> | null,
  signer: PortalFinancialDocumentHrefSigner,
) {
  if (!isAvailableLocalArtifact(metadata)) return null;
  const r2Key = localArtifactR2Key(metadata);
  return r2Key ? signer(r2Key) : null;
}

export async function resolvePortalFinancialDocumentHrefs(params: {
  organizationId: string;
  billingDocumentId: number;
  fiscalAccessKey: string | null;
  receiptIds: number[];
  signer: PortalFinancialDocumentHrefSigner;
}): Promise<PortalFinancialDocumentHrefMap> {
  const invoiceLocalEntityId = `billing_document:${params.billingDocumentId}:sale_pdf`;
  const candidateLocalEntityIds = [
    invoiceLocalEntityId,
    ...fiscalRemoteDocumentCandidates(params.fiscalAccessKey),
    ...receiptRemoteDocumentCandidates(params.receiptIds),
  ];

  if (candidateLocalEntityIds.length === 0) return {};

  // Candidate IDs are derived from the already-authorized service order's
  // billing document, fiscal access key, and receipts; the org predicate keeps
  // the signed artifact lookup inside the lab tenant.
  const links = await db
    .select({
      localEntityId: integrationObjectLink.localEntityId,
      metadata: integrationObjectLink.metadata,
    })
    .from(integrationObjectLink)
    .where(
      and(
        eq(integrationObjectLink.organizationId, params.organizationId),
        eq(integrationObjectLink.target, "remote_document"),
        inArray(integrationObjectLink.localEntityId, candidateLocalEntityIds),
      ),
    );

  const receipts: Record<number, string | null> = {};
  let invoice: string | null = null;
  let fiscalDocument: string | null = null;

  const signedLinks = await Promise.all(
    links.map(async (link) => ({
      ...link,
      kind: getRemoteDocumentKind(link.metadata ?? null),
      href: await signRemoteDocumentLink(link.metadata ?? null, params.signer),
    })),
  );

  for (const link of signedLinks) {
    const { kind, href } = link;
    if (!href) continue;

    if (link.localEntityId === invoiceLocalEntityId && kind === "sale_pdf") {
      invoice = href;
      continue;
    }

    if (kind === "fiscal_xml") {
      fiscalDocument = href;
      continue;
    }

    const receiptId = getReceiptIdFromRemoteDocumentLocalId(link.localEntityId);
    if (receiptId !== null && kind === "receipt_pdf") {
      receipts[receiptId] = href;
    }
  }

  return { invoice, fiscalDocument, receipts };
}

function mostRecentIso(values: Array<string | null | undefined>) {
  let mostRecent: Date | null = null;
  for (const value of values) {
    if (!value) continue;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) continue;
    if (!mostRecent || date.getTime() > mostRecent.getTime()) {
      mostRecent = date;
    }
  }
  return mostRecent?.toISOString() ?? null;
}

function earliestIso(values: Array<string | null | undefined>) {
  let earliest: Date | null = null;
  for (const value of values) {
    if (!value) continue;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) continue;
    if (!earliest || date.getTime() < earliest.getTime()) earliest = date;
  }
  return earliest?.toISOString() ?? null;
}

function getFreshness(status: FinancialFreshness["status"]) {
  return status === "fresh" || status === "stale" ? status : "unknown";
}

function deriveLastKnownStatus(
  financialStatus: ServiceOrderFinancialStatus,
): FinancialContinuityStatus {
  return deriveFinancialContinuityStatus({
    hasBillingDocument: Boolean(financialStatus.billingDocument),
    billingDocumentStatus: financialStatus.billingDocument?.status ?? null,
    exportStatus: financialStatus.billingDocument?.exportStatus ?? null,
    installmentStatuses: financialStatus.installments.map(
      (installment) => installment.status,
    ),
    blockers: [],
    isStale: financialStatus.freshness.status !== "fresh",
    isConfigured: true,
  });
}

function deriveLastKnownNonDegradedState(
  financialStatus: ServiceOrderFinancialStatus,
  overdueAmountCents: number,
): PortalServiceOrderFinancialSummaryState | null {
  if (!financialStatus.billingDocument) return null;
  if (financialStatus.billingDocument.status === "PAID") return "PAID";
  if (financialStatus.billingDocument.status === "OVERDUE") {
    return overdueAmountCents > 0 ? "OVERDUE" : "PAYMENT_PENDING";
  }

  const activeInstallments = financialStatus.installments.filter(
    (installment) => installment.status !== "VOID",
  );
  if (activeInstallments.length) {
    if (
      activeInstallments.every((installment) => installment.status === "PAID")
    ) {
      return "PAID";
    }
    if (
      activeInstallments.some((installment) => installment.status === "OVERDUE")
    ) {
      return overdueAmountCents > 0 ? "OVERDUE" : "PAYMENT_PENDING";
    }
    return "PAYMENT_PENDING";
  }

  if (
    financialStatus.billingDocument.status === "ISSUED" ||
    financialStatus.billingDocument.exportStatus === "EXPORTED"
  ) {
    return "INVOICE_AVAILABLE";
  }

  return null;
}

function getOpenAmountCents(
  status: ServiceOrderFinancialStatus,
  portalState: PortalServiceOrderFinancialSummaryState,
) {
  if (portalState === "PAID") return 0;

  const activeInstallments = status.installments.filter(
    (installment) =>
      installment.status === "OPEN" || installment.status === "OVERDUE",
  );
  if (activeInstallments.length) {
    return activeInstallments.reduce(
      (sum, installment) => sum + installment.amountCents,
      0,
    );
  }
  return status.billingDocument?.status === "PAID"
    ? 0
    : (status.billingDocument?.totalCents ?? 0);
}

function getOverdueAmountCents(status: ServiceOrderFinancialStatus) {
  return status.installments
    .filter((installment) => installment.status === "OVERDUE")
    .reduce((sum, installment) => sum + installment.amountCents, 0);
}

function mapPortalState(input: {
  status: ServiceOrderFinancialStatus;
  lastKnownStatus: FinancialContinuityStatus;
  overdueAmountCents: number;
}): PortalServiceOrderFinancialSummaryState | null {
  if (!input.status.billingDocument) return null;

  if (input.lastKnownStatus === "PAID") return "PAID";
  if (input.lastKnownStatus === "OVERDUE") {
    return input.overdueAmountCents > 0 ? "OVERDUE" : "PAYMENT_PENDING";
  }
  if (
    input.lastKnownStatus === "AWAITING_PAYMENT" ||
    input.lastKnownStatus === "PARTIALLY_PAID"
  ) {
    return "PAYMENT_PENDING";
  }
  if (
    input.lastKnownStatus === "INVOICE_AVAILABLE" ||
    input.lastKnownStatus === "SENT_TO_FINANCE"
  ) {
    return "INVOICE_AVAILABLE";
  }
  if (input.lastKnownStatus === "STATUS_UNAVAILABLE") {
    return deriveLastKnownNonDegradedState(
      input.status,
      input.overdueAmountCents,
    );
  }
  if (
    input.status.billingDocument.status === "ISSUED" ||
    input.status.billingDocument.exportStatus === "EXPORTED"
  ) {
    return "INVOICE_AVAILABLE";
  }

  return null;
}

export function toPortalServiceOrderFinancialSummary(
  financialStatus: ServiceOrderFinancialStatus,
  options: { documentHrefs?: PortalFinancialDocumentHrefMap } = {},
): PortalServiceOrderFinancialSummary {
  if (
    !financialStatus.providerEvidence ||
    financialStatus.providerEvidence.integrationState !== "connected" ||
    financialStatus.freshness.status === "local_only" ||
    !financialStatus.billingDocument ||
    financialStatus.billingDocument.status === "VOID"
  ) {
    return hiddenSummary;
  }

  const lastKnownStatus = deriveLastKnownStatus(financialStatus);
  const overdueAmountCents = getOverdueAmountCents(financialStatus);
  const portalState =
    mapPortalState({
      status: financialStatus,
      lastKnownStatus,
      overdueAmountCents,
    }) ?? null;
  if (!portalState) return hiddenSummary;

  const paidAt = mostRecentIso([
    ...financialStatus.receipts.map((receipt) => receipt.receivedAt),
    ...financialStatus.installments.map((installment) => installment.paidAt),
  ]);
  const dueDate =
    earliestIso(
      financialStatus.installments
        .filter((installment) => installment.status !== "PAID")
        .map((installment) => installment.dueDate),
    ) ?? financialStatus.billingDocument.dueDate;

  const documents: PortalServiceOrderFinancialSummary["documents"] = [];

  addDocumentRow(documents, {
    kind: "invoice",
    label: "Fatura",
    availableAt: financialStatus.billingDocument.issuedAt,
    href: options.documentHrefs?.invoice ?? null,
  });

  if (
    financialStatus.fiscalDocument.availability === "AVAILABLE" ||
    financialStatus.fiscalDocument.availability === "WARNINGS"
  ) {
    addDocumentRow(documents, {
      kind: "fiscal_document",
      label: "Documento fiscal",
      availableAt:
        financialStatus.fiscalDocument.issuedAt ??
        financialStatus.fiscalDocument.lastSyncedAt,
      href: options.documentHrefs?.fiscalDocument ?? null,
    });
  }

  for (const receipt of financialStatus.receipts) {
    addDocumentRow(documents, {
      kind: "receipt",
      label: "Recibo",
      availableAt: receipt.receivedAt,
      href: options.documentHrefs?.receipts?.[receipt.id] ?? null,
    });
  }

  return {
    state: portalState,
    visible: true,
    dueDate: portalState === "PAID" ? null : dueDate,
    paidAt: portalState === "PAID" ? paidAt : null,
    openAmountCents: getOpenAmountCents(financialStatus, portalState),
    overdueAmountCents: portalState === "OVERDUE" ? overdueAmountCents : 0,
    lastUpdatedAt: mostRecentIso([
      financialStatus.freshness.lastSyncedAt,
      financialStatus.fiscalDocument.lastSyncedAt,
      paidAt,
      financialStatus.billingDocument.issuedAt,
    ]),
    freshness: getFreshness(financialStatus.freshness.status),
    documents,
  };
}

export async function buildPortalServiceOrderFinancialSummary(params: {
  organizationId: string;
  serviceOrderId: number;
  scope: PortalFinancialScope;
  documentHrefSigner?: PortalFinancialDocumentHrefSigner;
}): Promise<PortalServiceOrderFinancialSummary | null> {
  const financialStatus = await buildServiceOrderFinancialStatus({
    organizationId: params.organizationId,
    serviceOrderId: params.serviceOrderId,
    scope: params.scope,
    includeProviderEvidence: true,
  });

  if (!financialStatus) return null;

  const documentHrefs =
    params.documentHrefSigner && financialStatus.billingDocument
      ? await resolvePortalFinancialDocumentHrefs({
          organizationId: params.organizationId,
          billingDocumentId: financialStatus.billingDocument.id,
          fiscalAccessKey: financialStatus.fiscalDocument.accessKey,
          receiptIds: financialStatus.receipts.map((receipt) => receipt.id),
          signer: params.documentHrefSigner,
        })
      : undefined;

  return toPortalServiceOrderFinancialSummary(financialStatus, {
    documentHrefs,
  });
}
