import { db } from "@calibra-facil/db";
import {
  billingDocument,
  calibrationJob,
  customer,
  integrationObjectLink,
  integrationSyncCursor,
  organizationIntegration,
  organizationUnit,
  paymentReceipt,
  receivableInstallment,
  serviceOrder,
  serviceOrderCertificateLink,
} from "@calibra-facil/db/schema";
import {
  buildFinancialFreshness,
  deriveFinancialContinuityStatus,
  getBillingReadinessStatusLabel,
  getFinancialContinuityStatusLabel,
  getFiscalDocumentAvailabilityLabel,
  getReceivableInstallmentStatusLabel,
  type BillingBlocker,
  type BillingIntegrationState,
  type BillingReadinessStatus,
  type CustomerFinancialTimeline,
  type CustomerFinancialTimelineDocument,
  getFinancialContinuityStatusDescription,
  type FinancialFiscalDocument,
  type FinancialFreshness,
  type FinancialInstallmentStatus,
  type FinancialProviderEvidence,
  type FinancialReceiptStatus,
  type ServiceOrderFinancialStatus,
  FINANCIAL_FRESHNESS_STALE_AFTER_HOURS,
  summarizeInstallments,
} from "@calibra-facil/shared";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { getFinancialIntegrationState } from "./billing-readiness";
import {
  evaluateOrderBlockers,
  resolveServiceOrderBillingDocumentLinks,
} from "./finance";
import { buildUnitScopeCondition } from "./units";

type UnitScope = Parameters<typeof buildUnitScopeCondition>[1];
type FinancialTimelineScope = UnitScope & {
  activeUnitName?: string | null;
  canAccessAllUnits?: boolean;
};

const CUSTOMER_TIMELINE_LIMIT = 20;
const CUSTOMER_TIMELINE_MAX_LIMIT = 50;
const RECONNECT_PATH = "/dashboard/settings/integrations#financial-erp";

function toIso(value: Date | null | undefined) {
  return value?.toISOString() ?? null;
}

function getProviderLabel(provider: string) {
  return provider === "conta_azul" ? "Conta Azul" : "integração financeira";
}

function buildProviderEvidence(input: {
  provider: string | null;
  integrationState: BillingIntegrationState;
  freshnessStatus?: FinancialFreshness["status"];
}): FinancialProviderEvidence | null {
  if (!input.provider) return null;
  const label = getProviderLabel(input.provider);
  const isUnavailable =
    input.integrationState === "connected" &&
    (input.freshnessStatus === "stale" || input.freshnessStatus === "unknown");
  return {
    label: isUnavailable
      ? `${label} sem atualização recente`
      : input.integrationState === "connected"
        ? `Sincronizado via ${label}`
        : `Reconecte ${label} para atualizar o status`,
    integrationState: input.integrationState,
    reconnectPath:
      input.integrationState === "connected" ? null : RECONNECT_PATH,
  };
}

function buildUnavailableStatusDescription(freshness: FinancialFreshness) {
  if (!freshness.lastSyncedAt) {
    return "Status indisponível - sem sincronização recente";
  }

  const lastSyncedAt = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(freshness.lastSyncedAt));

  return `Status indisponível - última sincronização em ${lastSyncedAt}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function booleanValue(value: unknown) {
  return typeof value === "boolean" ? value : false;
}

function numberValue(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function nestedRecord(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const value = record[key];
  return isRecord(value) ? value : null;
}

function fiscalMetadata(
  metadata: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!metadata) return null;
  return nestedRecord(metadata, "fiscal");
}

function linkFiscalSaleRemoteId(metadata: Record<string, unknown> | null) {
  const fiscal = fiscalMetadata(metadata);
  return fiscal ? textValue(fiscal.saleRemoteId) : null;
}

function linkFiscalContractRemoteId(metadata: Record<string, unknown> | null) {
  const fiscal = fiscalMetadata(metadata);
  return fiscal ? textValue(fiscal.contractRemoteId) : null;
}

function mapFiscalDocument(input: {
  metadata: Record<string, unknown> | null;
  lastSyncedAt: Date | null;
  freshness: FinancialFreshness;
}): FinancialFiscalDocument {
  const fiscal = fiscalMetadata(input.metadata);
  if (!fiscal) {
    return {
      availability: "UNAVAILABLE",
      label: getFiscalDocumentAvailabilityLabel("UNAVAILABLE"),
      number: null,
      issuedAt: null,
      accessKey: null,
      xmlAvailable: false,
      consultationOnly: true,
      lastSyncedAt: toIso(input.lastSyncedAt),
    };
  }

  const hasEvidence = Boolean(
    textValue(fiscal.number) ?? textValue(fiscal.accessKey),
  );
  // Fiscal availability follows the centralized financial freshness threshold.
  const availability =
    input.freshness.status === "stale" || input.freshness.status === "unknown"
      ? "WARNINGS"
      : hasEvidence
        ? "AVAILABLE"
        : "PENDING";

  return {
    availability,
    label: getFiscalDocumentAvailabilityLabel(availability),
    number: textValue(fiscal.number),
    issuedAt: textValue(fiscal.issuedAt),
    accessKey: textValue(fiscal.accessKey),
    xmlAvailable: booleanValue(fiscal.xmlAvailable),
    consultationOnly: booleanValue(fiscal.consultationOnly),
    lastSyncedAt: toIso(input.lastSyncedAt),
  };
}

const emptyFiscalDocument: FinancialFiscalDocument = {
  availability: "NONE",
  label: getFiscalDocumentAvailabilityLabel("NONE"),
  number: null,
  issuedAt: null,
  accessKey: null,
  xmlAvailable: false,
  consultationOnly: true,
  lastSyncedAt: null,
};

function mapInstallment(
  installment: typeof receivableInstallment.$inferSelect,
): FinancialInstallmentStatus {
  return {
    id: installment.id,
    installmentNumber: installment.installmentNumber,
    status: installment.status,
    label: getReceivableInstallmentStatusLabel(installment.status),
    amountCents: installment.amountCents,
    currency: installment.currency,
    dueDate: installment.dueDate.toISOString(),
    paidAt: toIso(installment.paidAt),
    paymentMethod: installment.paymentMethod ?? null,
  };
}

function mapReceipt(
  receipt: typeof paymentReceipt.$inferSelect,
): FinancialReceiptStatus {
  return {
    id: receipt.id,
    installmentId: receipt.installmentId,
    receivedAt: receipt.receivedAt.toISOString(),
    amountCents: receipt.amountCents,
    paymentMethod: receipt.paymentMethod,
    reference: receipt.reference ?? null,
  };
}

function mostRecentDate(dates: Array<Date | null | undefined>) {
  let mostRecent: Date | null = null;
  for (const date of dates) {
    if (date && (!mostRecent || date.getTime() > mostRecent.getTime())) {
      mostRecent = date;
    }
  }
  return mostRecent;
}

async function getActiveFinancialProvider(params: {
  organizationId: string;
  includeProviderEvidence: boolean;
}) {
  if (!params.includeProviderEvidence) {
    return {
      provider: null,
      integrationIds: [],
      activeIntegrationId: null,
      hasProvider: false,
      lastSuccessfulPollAt: null,
    };
  }

  const integrations = await db
    .select({
      id: organizationIntegration.id,
      provider: organizationIntegration.provider,
      status: organizationIntegration.status,
    })
    .from(organizationIntegration)
    .where(
      and(
        eq(organizationIntegration.organizationId, params.organizationId),
        eq(organizationIntegration.type, "financial_erp"),
      ),
    );

  const activeIntegrations = integrations.filter(
    (integration) => integration.status === "ACTIVE",
  );
  const active = activeIntegrations[0];
  if (!active) {
    return {
      provider: null,
      integrationIds: [],
      activeIntegrationId: null,
      hasProvider: false,
      lastSuccessfulPollAt: null,
    };
  }

  const integrationIds = activeIntegrations.map(
    (integration) => integration.id,
  );
  const cursors = await db
    .select({
      integrationId: integrationSyncCursor.integrationId,
      lastSuccessfulPollAt: integrationSyncCursor.lastSuccessfulPollAt,
    })
    .from(integrationSyncCursor)
    .where(
      and(
        eq(integrationSyncCursor.organizationId, params.organizationId),
        inArray(integrationSyncCursor.integrationId, integrationIds),
      ),
    );

  return {
    provider: active.provider,
    integrationIds,
    activeIntegrationId: integrationIds.length === 1 ? active.id : null,
    hasProvider: true,
    lastSuccessfulPollAt: mostRecentDate(
      cursors
        .filter((cursor) => integrationIds.includes(cursor.integrationId))
        .map((cursor) => cursor.lastSuccessfulPollAt),
    ),
  };
}

function normalizeCustomerTimelineLimit(limit?: number) {
  return Math.min(
    limit ?? CUSTOMER_TIMELINE_LIMIT,
    CUSTOMER_TIMELINE_MAX_LIMIT,
  );
}

async function getDocumentLinks(params: {
  organizationId: string;
  integrationIds: string[];
  activeIntegrationId: string | null;
  documentIds: number[];
}) {
  if (!params.integrationIds.length || !params.documentIds.length) return [];
  const integrationIdCondition = params.activeIntegrationId
    ? eq(integrationObjectLink.integrationId, params.activeIntegrationId)
    : inArray(integrationObjectLink.integrationId, params.integrationIds);

  const billingLinks = await db
    .select({
      target: integrationObjectLink.target,
      localEntityId: integrationObjectLink.localEntityId,
      remoteEntityId: integrationObjectLink.remoteEntityId,
      metadata: integrationObjectLink.metadata,
      lastSyncedAt: integrationObjectLink.lastSyncedAt,
    })
    .from(integrationObjectLink)
    .where(
      and(
        eq(integrationObjectLink.organizationId, params.organizationId),
        integrationIdCondition,
        eq(integrationObjectLink.target, "billing_document"),
        inArray(
          integrationObjectLink.localEntityId,
          params.documentIds.map((id) => `billing_document:${id}`),
        ),
      ),
    );

  const linkedRemoteIds = new Set<string>();
  for (const link of billingLinks) {
    if (link.remoteEntityId) linkedRemoteIds.add(link.remoteEntityId);
    const saleRemoteId = isRecord(link.metadata)
      ? textValue(link.metadata.saleRemoteId)
      : null;
    if (saleRemoteId) linkedRemoteIds.add(saleRemoteId);
  }

  if (!linkedRemoteIds.size) return billingLinks;

  const maxRemoteIds = Math.max(params.documentIds.length * 2, 1);
  const remoteIds = [...linkedRemoteIds].slice(0, maxRemoteIds);
  const fiscalLinks = await db
    .select({
      target: integrationObjectLink.target,
      localEntityId: integrationObjectLink.localEntityId,
      remoteEntityId: integrationObjectLink.remoteEntityId,
      metadata: integrationObjectLink.metadata,
      lastSyncedAt: integrationObjectLink.lastSyncedAt,
    })
    .from(integrationObjectLink)
    .where(
      and(
        eq(integrationObjectLink.organizationId, params.organizationId),
        integrationIdCondition,
        eq(integrationObjectLink.target, "fiscal_document"),
        or(
          inArray(
            sql<string>`${integrationObjectLink.metadata}->'fiscal'->>'saleRemoteId'`,
            remoteIds,
          ),
          inArray(
            sql<string>`${integrationObjectLink.metadata}->'fiscal'->>'contractRemoteId'`,
            remoteIds,
          ),
        ),
      ),
    );

  return [...billingLinks, ...fiscalLinks];
}

function matchFiscalLinksToDocument(input: {
  fiscalLinks: Awaited<ReturnType<typeof getDocumentLinks>>;
  billingLinkRemoteIds: Set<string>;
  billingLinkMetadata: Array<Record<string, unknown> | null>;
}) {
  const saleRemoteIds = new Set(input.billingLinkRemoteIds);
  for (const metadata of input.billingLinkMetadata) {
    const saleRemoteId = metadata ? textValue(metadata.saleRemoteId) : null;
    if (saleRemoteId) saleRemoteIds.add(saleRemoteId);
  }

  return input.fiscalLinks.filter((link) => {
    if (link.target !== "fiscal_document") return false;
    const metadata = link.metadata ?? null;
    const saleRemoteId = linkFiscalSaleRemoteId(metadata);
    const contractRemoteId = linkFiscalContractRemoteId(metadata);
    // Exact sale/contract linkage is required for row-level fiscal confidence.
    // Conta Azul NF-e product-invoice metadata currently has no sale linkage, so
    // those links remain unattached instead of falling back to customer names.
    if (saleRemoteId && saleRemoteIds.has(saleRemoteId)) return true;
    if (contractRemoteId && saleRemoteIds.has(contractRemoteId)) return true;
    return false;
  });
}

function buildDocumentFreshness(input: {
  includeProviderEvidence: boolean;
  cursorLastSuccessfulPollAt: Date | null;
  linkLastSyncedAt: Date | null;
}) {
  const lastSyncedAt = mostRecentDate([
    input.cursorLastSuccessfulPollAt,
    input.linkLastSyncedAt,
  ]);
  return buildFinancialFreshness({
    hasProviderEvidence: input.includeProviderEvidence,
    lastSyncedAt: toIso(lastSyncedAt),
    staleAfterHours: FINANCIAL_FRESHNESS_STALE_AFTER_HOURS,
  });
}

function buildCustomerTimelineScopeLabel(scope: FinancialTimelineScope) {
  if (scope.selectedUnitScope === "all" && scope.canAccessAllUnits) {
    return "Todas as unidades";
  }

  return scope.activeUnitName
    ? `Unidade ${scope.activeUnitName}`
    : "Unidade ativa";
}

export async function buildServiceOrderFinancialStatus(params: {
  organizationId: string;
  scope: FinancialTimelineScope;
  serviceOrderId: number;
  includeProviderEvidence: boolean;
}): Promise<ServiceOrderFinancialStatus | null> {
  const [order] = await db
    .select({
      id: serviceOrder.id,
      number: serviceOrder.serviceOrderNumber,
      customerId: serviceOrder.customerId,
      customerName: customer.name,
      taxId: customer.taxId,
      email: customer.email,
      address: customer.address,
      unitId: serviceOrder.unitId,
      amountApprovedCents: serviceOrder.totalApprovedCents,
      amountQuotedCents: serviceOrder.totalQuotedCents,
      billingDocumentId: serviceOrder.billingDocumentId,
    })
    .from(serviceOrder)
    .innerJoin(customer, eq(serviceOrder.customerId, customer.id))
    .where(
      and(
        eq(serviceOrder.organizationId, params.organizationId),
        eq(serviceOrder.id, params.serviceOrderId),
        buildUnitScopeCondition(serviceOrder.unitId, params.scope),
      ),
    )
    .limit(1);

  if (!order) return null;

  const certificateLinks = await db
    .select({
      jobId: calibrationJob.id,
      jobStatus: calibrationJob.status,
    })
    .from(serviceOrderCertificateLink)
    .innerJoin(
      calibrationJob,
      eq(serviceOrderCertificateLink.certificateJobId, calibrationJob.id),
    )
    .where(eq(serviceOrderCertificateLink.serviceOrderId, order.id));

  const resolvedLinks = await resolveServiceOrderBillingDocumentLinks(
    [
      {
        serviceOrderId: order.id,
        directBillingDocumentId: order.billingDocumentId,
        certificateJobIds: certificateLinks.map((link) => link.jobId),
      },
    ],
    params.organizationId,
  );
  // The billing-readiness resolver intentionally ignores VOID documents, so a
  // voided service-order document can return to the ready/blocker path here.
  const resolved = resolvedLinks.get(order.id) ?? null;

  const amountCents =
    order.amountApprovedCents > 0
      ? order.amountApprovedCents
      : order.amountQuotedCents;
  const blockers: BillingBlocker[] = resolved
    ? []
    : evaluateOrderBlockers({
        customer: {
          taxId: order.taxId,
          email: order.email,
          address: order.address,
        },
        certificateJobStatuses: certificateLinks.map((link) => link.jobStatus),
        amountCents,
      });
  const readinessStatus: BillingReadinessStatus | null = resolved
    ? resolved.exportStatus === "EXPORTED"
      ? "SENT"
      : "BILLED"
    : blockers.length
      ? "BLOCKED"
      : "READY";

  const documentRows = resolved
    ? await db
        .select()
        .from(billingDocument)
        .where(
          and(
            eq(billingDocument.organizationId, params.organizationId),
            eq(billingDocument.id, resolved.documentId),
          ),
        )
        .limit(1)
    : [];
  const document = documentRows[0] ?? null;
  const installments = document
    ? await db
        .select()
        .from(receivableInstallment)
        .where(eq(receivableInstallment.documentId, document.id))
        .orderBy(receivableInstallment.installmentNumber)
    : [];
  const receipts = installments.length
    ? await db
        .select()
        .from(paymentReceipt)
        .where(
          inArray(
            paymentReceipt.installmentId,
            installments.map((installment) => installment.id),
          ),
        )
        .orderBy(desc(paymentReceipt.receivedAt))
    : [];

  const integrationState = params.includeProviderEvidence
    ? await getFinancialIntegrationState(params.organizationId)
    : "not_configured";
  const provider = await getActiveFinancialProvider(params);
  const links = document
    ? await getDocumentLinks({
        organizationId: params.organizationId,
        integrationIds: provider.integrationIds,
        activeIntegrationId: provider.activeIntegrationId,
        documentIds: [document.id],
      })
    : [];
  const billingLinks = links.filter(
    (link) =>
      link.target === "billing_document" &&
      link.localEntityId === `billing_document:${document?.id}`,
  );
  const fiscalLinks = matchFiscalLinksToDocument({
    fiscalLinks: links,
    billingLinkRemoteIds: new Set(
      billingLinks
        .map((link) => link.remoteEntityId)
        .filter((remoteEntityId) => remoteEntityId !== null),
    ),
    billingLinkMetadata: billingLinks.map((link) => link.metadata ?? null),
  });
  const linkLastSyncedAt = mostRecentDate([
    ...billingLinks.map((link) => link.lastSyncedAt),
    ...fiscalLinks.map((link) => link.lastSyncedAt),
  ]);
  const hasProviderEvidence =
    params.includeProviderEvidence && provider.hasProvider;
  const freshness = buildDocumentFreshness({
    includeProviderEvidence: hasProviderEvidence,
    cursorLastSuccessfulPollAt: provider.lastSuccessfulPollAt,
    linkLastSyncedAt,
  });
  const status = deriveFinancialContinuityStatus({
    hasBillingDocument: Boolean(document),
    billingDocumentStatus: document?.status ?? null,
    exportStatus: document?.exportStatus ?? null,
    installmentStatuses: installments.map((installment) => installment.status),
    blockers,
    isStale:
      hasProviderEvidence &&
      Boolean(document) &&
      freshness.status !== "fresh" &&
      document?.exportStatus === "EXPORTED",
  });
  const fiscalDocument =
    params.includeProviderEvidence && fiscalLinks[0]
      ? mapFiscalDocument({
          metadata: fiscalLinks[0].metadata ?? null,
          lastSyncedAt: fiscalLinks[0].lastSyncedAt,
          freshness,
        })
      : emptyFiscalDocument;

  return {
    serviceOrderId: order.id,
    serviceOrderNumber: order.number,
    status,
    label: getFinancialContinuityStatusLabel(status),
    description:
      status === "STATUS_UNAVAILABLE"
        ? buildUnavailableStatusDescription(freshness)
        : status === "READY_FOR_BILLING" || status === "BLOCKED"
          ? getBillingReadinessStatusLabel(readinessStatus)
          : getFinancialContinuityStatusDescription(status),
    readinessStatus,
    blockers,
    amountCents,
    currency: document?.currency ?? "BRL",
    billingDocument: document
      ? {
          id: document.id,
          documentNumber: document.documentNumber ?? null,
          status: document.status,
          exportStatus: document.exportStatus,
          issuedAt: toIso(document.issueDate),
          dueDate: document.dueDate.toISOString(),
          totalCents: document.totalCents,
          currency: document.currency,
        }
      : null,
    installments: installments.map(mapInstallment),
    installmentsSummary: summarizeInstallments(installments),
    receipts: receipts.map(mapReceipt),
    fiscalDocument,
    freshness,
    providerEvidence: hasProviderEvidence
      ? buildProviderEvidence({
          provider: provider.provider,
          integrationState,
          freshnessStatus: freshness.status,
        })
      : null,
  };
}

export async function buildCustomerFinancialTimeline(params: {
  organizationId: string;
  scope: FinancialTimelineScope;
  customerId: number;
  includeProviderEvidence: boolean;
  limit?: number;
}): Promise<CustomerFinancialTimeline | null> {
  const limit = normalizeCustomerTimelineLimit(params.limit);
  const queryLimit = limit + 1;

  const [customerRow] = await db
    .select({ id: customer.id, name: customer.name })
    .from(customer)
    .where(
      and(
        eq(customer.labOrganizationId, params.organizationId),
        eq(customer.id, params.customerId),
      ),
    )
    .limit(1);
  if (!customerRow) return null;

  const documentRows = await db
    .select({
      id: billingDocument.id,
      documentNumber: billingDocument.documentNumber,
      status: billingDocument.status,
      exportStatus: billingDocument.exportStatus,
      issueDate: billingDocument.issueDate,
      dueDate: billingDocument.dueDate,
      totalCents: billingDocument.totalCents,
      currency: billingDocument.currency,
      unitId: organizationUnit.id,
      unitName: organizationUnit.name,
      totalDocuments: sql<number>`count(*) over ()::int`,
    })
    .from(billingDocument)
    .innerJoin(
      organizationUnit,
      eq(billingDocument.unitId, organizationUnit.id),
    )
    .where(
      and(
        eq(billingDocument.organizationId, params.organizationId),
        eq(billingDocument.customerId, params.customerId),
        // The customer itself resolves at org scope, but financial amounts stay
        // unit-scoped so restricted users cannot infer other units' balances.
        buildUnitScopeCondition(billingDocument.unitId, params.scope),
      ),
    )
    .orderBy(
      sql`${billingDocument.issueDate} desc nulls last`,
      desc(billingDocument.createdAt),
    )
    .limit(queryLimit);
  const isTruncated = documentRows.length > limit;
  const documents = documentRows.slice(0, limit);

  const documentIds = documents.map((document) => document.id);
  const totalDocumentsFromPage = numberValue(documentRows[0]?.totalDocuments);
  const installments = documentIds.length
    ? await db
        .select()
        .from(receivableInstallment)
        .where(inArray(receivableInstallment.documentId, documentIds))
        .orderBy(receivableInstallment.dueDate)
    : [];
  const receipts = installments.length
    ? await db
        .select()
        .from(paymentReceipt)
        .where(
          inArray(
            paymentReceipt.installmentId,
            installments.map((installment) => installment.id),
          ),
        )
        .orderBy(desc(paymentReceipt.receivedAt))
    : [];
  const [summaryTotals] = isTruncated
    ? await db
        .select({
          totalDocuments: sql<number>`count(distinct ${billingDocument.id})::int`,
          openCents: sql<number>`coalesce(sum(${receivableInstallment.amountCents}) filter (where ${receivableInstallment.status} = 'OPEN'), 0)::int`,
          overdueCents: sql<number>`coalesce(sum(${receivableInstallment.amountCents}) filter (where ${receivableInstallment.status} = 'OVERDUE'), 0)::int`,
          receivedCents: sql<number>`coalesce(sum(${paymentReceipt.amountCents}), 0)::int`,
        })
        .from(billingDocument)
        .innerJoin(
          organizationUnit,
          eq(billingDocument.unitId, organizationUnit.id),
        )
        .leftJoin(
          receivableInstallment,
          eq(receivableInstallment.documentId, billingDocument.id),
        )
        .leftJoin(
          paymentReceipt,
          eq(paymentReceipt.installmentId, receivableInstallment.id),
        )
        .where(
          and(
            eq(billingDocument.organizationId, params.organizationId),
            eq(billingDocument.customerId, params.customerId),
            buildUnitScopeCondition(billingDocument.unitId, params.scope),
          ),
        )
    : [];

  const integrationState = params.includeProviderEvidence
    ? await getFinancialIntegrationState(params.organizationId)
    : "not_configured";
  const provider = await getActiveFinancialProvider(params);
  const hasProviderEvidence =
    params.includeProviderEvidence && provider.hasProvider;
  const timelineFreshness = buildFinancialFreshness({
    hasProviderEvidence,
    lastSyncedAt: toIso(provider.lastSuccessfulPollAt),
    staleAfterHours: FINANCIAL_FRESHNESS_STALE_AFTER_HOURS,
  });
  const links = await getDocumentLinks({
    organizationId: params.organizationId,
    integrationIds: provider.integrationIds,
    activeIntegrationId: provider.activeIntegrationId,
    documentIds,
  });

  const installmentsByDocumentId = new Map<number, typeof installments>();
  for (const installment of installments) {
    const list = installmentsByDocumentId.get(installment.documentId) ?? [];
    list.push(installment);
    installmentsByDocumentId.set(installment.documentId, list);
  }
  const receiptsByInstallmentId = new Map<number, typeof receipts>();
  for (const receipt of receipts) {
    const list = receiptsByInstallmentId.get(receipt.installmentId) ?? [];
    list.push(receipt);
    receiptsByInstallmentId.set(receipt.installmentId, list);
  }

  const data: CustomerFinancialTimelineDocument[] = documents.map(
    (document) => {
      const documentInstallments =
        installmentsByDocumentId.get(document.id) ?? [];
      const documentReceipts = documentInstallments.flatMap(
        (installment) => receiptsByInstallmentId.get(installment.id) ?? [],
      );
      const billingLinks = links.filter(
        (link) =>
          link.target === "billing_document" &&
          link.localEntityId === `billing_document:${document.id}`,
      );
      const fiscalLinks = matchFiscalLinksToDocument({
        fiscalLinks: links,
        billingLinkRemoteIds: new Set(
          billingLinks
            .map((link) => link.remoteEntityId)
            .filter((remoteEntityId) => remoteEntityId !== null),
        ),
        billingLinkMetadata: billingLinks.map((link) => link.metadata ?? null),
      });
      const freshness = buildDocumentFreshness({
        includeProviderEvidence: hasProviderEvidence,
        cursorLastSuccessfulPollAt: provider.lastSuccessfulPollAt,
        linkLastSyncedAt: mostRecentDate([
          ...billingLinks.map((link) => link.lastSyncedAt),
          ...fiscalLinks.map((link) => link.lastSyncedAt),
        ]),
      });
      const hasRowProviderLink =
        billingLinks.length > 0 || fiscalLinks.length > 0;
      const status = deriveFinancialContinuityStatus({
        hasBillingDocument: true,
        billingDocumentStatus: document.status,
        exportStatus: document.exportStatus,
        installmentStatuses: documentInstallments.map(
          (installment) => installment.status,
        ),
        isStale:
          hasProviderEvidence &&
          freshness.status !== "fresh" &&
          document.exportStatus === "EXPORTED",
      });

      return {
        id: document.id,
        documentNumber: document.documentNumber ?? null,
        status: document.status,
        exportStatus: document.exportStatus,
        continuityStatus: status,
        label: getFinancialContinuityStatusLabel(status),
        issueDate: toIso(document.issueDate),
        dueDate: document.dueDate.toISOString(),
        totalCents: document.totalCents,
        currency: document.currency,
        unit: { id: document.unitId, name: document.unitName },
        installments: documentInstallments.map(mapInstallment),
        receipts: documentReceipts.map(mapReceipt),
        fiscalDocuments: hasProviderEvidence
          ? fiscalLinks.map((link) =>
              mapFiscalDocument({
                metadata: link.metadata ?? null,
                lastSyncedAt: link.lastSyncedAt,
                freshness,
              }),
            )
          : [],
        freshness,
        providerEvidence:
          hasProviderEvidence && hasRowProviderLink
            ? buildProviderEvidence({
                provider: provider.provider,
                integrationState,
                freshnessStatus: freshness.status,
              })
            : null,
      };
    },
  );

  return {
    customerId: customerRow.id,
    freshness: timelineFreshness,
    summary: {
      scope: "recent_documents",
      scopeLabel: buildCustomerTimelineScopeLabel(params.scope),
      limit,
      isTruncated,
      documents: data.length,
      totalDocuments: isTruncated
        ? totalDocumentsFromPage || numberValue(summaryTotals?.totalDocuments)
        : documentIds.length,
      openCents: isTruncated
        ? numberValue(summaryTotals?.openCents)
        : installments
            .filter((installment) => installment.status === "OPEN")
            .reduce((sum, installment) => sum + installment.amountCents, 0),
      overdueCents: isTruncated
        ? numberValue(summaryTotals?.overdueCents)
        : installments
            .filter((installment) => installment.status === "OVERDUE")
            .reduce((sum, installment) => sum + installment.amountCents, 0),
      receivedCents: isTruncated
        ? numberValue(summaryTotals?.receivedCents)
        : receipts.reduce((sum, receipt) => sum + receipt.amountCents, 0),
    },
    data,
  };
}
