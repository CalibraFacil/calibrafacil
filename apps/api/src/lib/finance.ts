import { db } from "@calibra-facil/db";
import {
  type CustomerAddress,
  type CustomerCompliance,
  billingDocument,
  billingDocumentItem,
  commercialAgreement,
  commercialAgreementServiceTerm,
  commercialAgreementUnitScope,
  customer,
  financialAuditLog,
  integrationConnection,
  integrationEventLog,
  integrationObjectLink,
  jobCommercialSnapshot,
  organizationIntegration,
  organizationUnit,
  receivableInstallment,
  calibrationJob,
  service,
  serviceOrder,
  serviceOrderCertificateLink,
} from "@calibra-facil/db/schema";
import {
  type BillingBlocker,
  type BillingDocumentStatus,
  type CommercialAgreementStatus,
  DEFAULT_FINANCIAL_PAYMENT_TERM_DAYS,
  applyIntegrationMappings,
  calculateFinancialDueDate,
  getBillingBlockerCodeLabel,
  normalizeContaAzulConnectionConfig,
  normalizeGenericFinancialErpConfig,
  isServiceOrderBillable,
  type FinancialStatus,
  type IntegrationBillingDocumentPayload,
} from "@calibra-facil/shared";
import {
  and,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import type { IntegrationsEnv } from "./integrations";
import { buildUnitScopeCondition } from "./units";
import { decryptPassword, encryptPassword } from "@calibra-facil/signing";
import { createFinancialErpAdapter } from "./financial-erp-adapters";
import {
  buildContaAzulRefreshFailurePolicy,
  getContaAzulOAuthConfig,
  parseContaAzulTokenBundle,
  refreshContaAzulAccessToken,
  serializeContaAzulTokenBundle,
} from "./conta-azul-oauth";

type FinanceDbExecutor = Pick<
  typeof db,
  "execute" | "insert" | "select" | "update"
>;

export type JobFinancialContext = {
  documentId: number | null;
  financialStatus: FinancialStatus;
  invoiceDocumentNumber: string | null;
  invoiceEligibility: boolean;
  overdueBalanceFlag: boolean;
};

export type CustomerFinancialSummary = {
  openDocumentsCount: number;
  overdueDocumentsCount: number;
  openBalanceCents: number;
  overdueBalanceCents: number;
  overdueBalanceFlag: boolean;
};

export type ActiveCommercialAgreementSummary = {
  id: number;
  agreementCode: string | null;
  title: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  currency: string;
  defaultPaymentTermDays: number;
};

type AgreementResolution = {
  agreement: typeof commercialAgreement.$inferSelect;
  term: typeof commercialAgreementServiceTerm.$inferSelect | null;
} | null;

const OPERATIONAL_FINANCE_SYSTEM_VERSION = "finance-v1";

/**
 * Pure billing-blocker evaluation for a single completed service order.
 * Provider-neutral: it only describes lab-side problems, never raw provider
 * errors. Kept side-effect free so it is trivially unit-testable.
 */
export function evaluateOrderBlockers(input: {
  customer: {
    taxId: string | null;
    email: string | null;
    address: CustomerAddress | null;
  };
  certificateJobStatuses: string[];
  amountCents: number;
  /**
   * Part line items on the approved quote that have no material-catalog
   * reference. Only relevant (and only passed) when the org's ERP export
   * runs in sale mode: every sale line must resolve to a remote
   * product/service, so an unlinked part would fail the whole export.
   */
  unmappedCatalogPartCount?: number;
}): BillingBlocker[] {
  const blockers: BillingBlocker[] = [];
  const { customer: c, certificateJobStatuses, amountCents } = input;

  // Phase 2 slice 5: emit granular payer-readiness blockers so operators
  // know exactly which field to fix, not just "Dados de cliente
  // incompletos". The code stays BLOCKED_BY_CUSTOMER_DATA so existing
  // queue consumers keep grouping these together.
  if (!c.taxId?.trim()) {
    blockers.push({
      code: "BLOCKED_BY_CUSTOMER_DATA",
      label: "CPF/CNPJ do cliente ausente",
      owner: "finance",
      fixAction: "Informe o CPF ou CNPJ do cliente",
      scope: "customer",
    });
  }
  if (!c.email?.trim()) {
    blockers.push({
      code: "BLOCKED_BY_CUSTOMER_DATA",
      label: "E-mail do cliente ausente",
      owner: "finance",
      fixAction: "Informe um e-mail válido para o cliente",
      scope: "customer",
    });
  }
  const addressIncomplete =
    !c.address || !c.address.city?.trim() || !c.address.state?.trim();
  if (addressIncomplete) {
    blockers.push({
      code: "BLOCKED_BY_CUSTOMER_DATA",
      label: "Endereço do cliente incompleto",
      owner: "finance",
      fixAction: "Complete cidade e estado no endereço do cliente",
      scope: "customer",
    });
  }

  if (
    certificateJobStatuses.length > 0 &&
    !certificateJobStatuses.some(
      (status) => status === "APPROVED" || status === "SUPERSEDED",
    )
  ) {
    blockers.push({
      code: "BLOCKED_BY_CERTIFICATE_STATUS",
      label: getBillingBlockerCodeLabel("BLOCKED_BY_CERTIFICATE_STATUS"),
      owner: "lab_ops",
      fixAction: "Conclua a aprovação técnica do certificado",
      scope: "order",
    });
  }

  if (amountCents <= 0) {
    blockers.push({
      code: "BLOCKED_BY_UNMAPPED_SERVICE",
      label: getBillingBlockerCodeLabel("BLOCKED_BY_UNMAPPED_SERVICE"),
      owner: "admin",
      fixAction: "Defina o valor aprovado ou o mapeamento do serviço",
      scope: "all_future",
    });
  }

  const unmappedParts = input.unmappedCatalogPartCount ?? 0;
  if (unmappedParts > 0) {
    blockers.push({
      code: "BLOCKED_BY_UNMAPPED_SERVICE",
      label:
        unmappedParts === 1
          ? "1 peça sem material do catálogo vinculado"
          : `${unmappedParts} peças sem material do catálogo vinculado`,
      owner: "commercial",
      fixAction: "Vincule as peças do orçamento a materiais do catálogo",
      scope: "order",
    });
  }

  return blockers;
}

export interface ServiceOrderBillingDocumentLinkInput {
  serviceOrderId: number;
  directBillingDocumentId: number | null;
  certificateJobIds: number[];
}

export interface ResolvedBillingDocumentLink {
  documentId: number;
  status: string;
  exportStatus: string;
}

export async function resolveServiceOrderBillingDocumentLinks(
  inputs: ServiceOrderBillingDocumentLinkInput[],
  organizationId: string,
): Promise<Map<number, ResolvedBillingDocumentLink>> {
  const serviceOrderIds = inputs.map((input) => input.serviceOrderId);
  const linkedJobIds = inputs.flatMap((input) => input.certificateJobIds);

  const itemMatchConditions = [
    serviceOrderIds.length
      ? inArray(billingDocumentItem.serviceOrderId, serviceOrderIds)
      : undefined,
    linkedJobIds.length
      ? inArray(billingDocumentItem.jobId, linkedJobIds)
      : undefined,
  ].filter(Boolean);

  const linkItems = itemMatchConditions.length
    ? await db
        .select({
          documentId: billingDocumentItem.documentId,
          serviceOrderId: billingDocumentItem.serviceOrderId,
          jobId: billingDocumentItem.jobId,
        })
        .from(billingDocumentItem)
        .innerJoin(
          billingDocument,
          eq(billingDocumentItem.documentId, billingDocument.id),
        )
        .where(
          and(
            eq(billingDocument.organizationId, organizationId),
            or(...itemMatchConditions),
          ),
        )
    : [];

  const candidateDocIds = new Set<number>();
  for (const input of inputs) {
    if (input.directBillingDocumentId) {
      candidateDocIds.add(input.directBillingDocumentId);
    }
  }
  for (const item of linkItems) candidateDocIds.add(item.documentId);

  const docs = candidateDocIds.size
    ? await db
        .select({
          id: billingDocument.id,
          status: billingDocument.status,
          exportStatus: billingDocument.exportStatus,
        })
        .from(billingDocument)
        .where(
          and(
            inArray(billingDocument.id, [...candidateDocIds]),
            eq(billingDocument.organizationId, organizationId),
            ne(billingDocument.status, "VOID"),
          ),
        )
    : [];
  const docById = new Map(docs.map((doc) => [doc.id, doc]));

  const docIdByOrderId = new Map<number, number>();
  const docIdByJobId = new Map<number, number>();
  for (const item of linkItems) {
    if (item.serviceOrderId) {
      docIdByOrderId.set(item.serviceOrderId, item.documentId);
    }
    if (item.jobId) docIdByJobId.set(item.jobId, item.documentId);
  }

  const resolved = new Map<number, ResolvedBillingDocumentLink>();
  for (const input of inputs) {
    let docId = input.directBillingDocumentId ?? undefined;
    if (!docId) docId = docIdByOrderId.get(input.serviceOrderId);
    if (!docId) {
      for (const jobId of input.certificateJobIds) {
        const viaJob = docIdByJobId.get(jobId);
        if (viaJob) {
          docId = viaJob;
          break;
        }
      }
    }

    const doc = docId ? docById.get(docId) : undefined;
    if (doc) {
      resolved.set(input.serviceOrderId, {
        documentId: doc.id,
        status: doc.status,
        exportStatus: doc.exportStatus,
      });
    }
  }

  return resolved;
}

function getAgreementDisplayCode(agreement: {
  agreementCode: string | null;
  id: number;
}) {
  return agreement.agreementCode?.trim() || `Contrato #${agreement.id}`;
}

function getIntegrationsMasterKey(env: IntegrationsEnv) {
  if (!env.INTEGRATIONS_MASTER_KEY) {
    throw new Error("INTEGRATIONS_MASTER_KEY não configurada");
  }

  return env.INTEGRATIONS_MASTER_KEY;
}

function decryptIntegrationSecret(
  encryptedSecret: string,
  secretIv: string,
  env: IntegrationsEnv,
) {
  return decryptPassword(
    encryptedSecret,
    secretIv,
    getIntegrationsMasterKey(env),
  );
}

function encryptIntegrationSecret(secret: string, env: IntegrationsEnv) {
  const { encryptedPassword, iv } = encryptPassword(
    secret,
    getIntegrationsMasterKey(env),
  );
  return { encryptedSecret: encryptedPassword, secretIv: iv };
}

async function writeFinanceIntegrationEvent(params: {
  details?: Record<string, unknown>;
  event: string;
  integrationId: string;
  level: "info" | "warning" | "error";
  message: string;
  organizationId: string;
}) {
  await db.insert(integrationEventLog).values({
    integrationId: params.integrationId,
    organizationId: params.organizationId,
    level: params.level,
    event: params.event,
    message: params.message,
    details: params.details ?? null,
  });
}

function toLowerBillingDocumentStatus(
  status: BillingDocumentStatus,
): IntegrationBillingDocumentPayload["status"] {
  switch (status) {
    case "DRAFT":
      return "draft";
    case "ISSUED":
      return "issued";
    case "PAID":
      return "paid";
    case "OVERDUE":
      return "overdue";
    case "VOID":
      return "void";
  }

  throw new Error(`Status de documento financeiro invalido: ${status}`);
}

function extractRemoteId(data: unknown): string | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;

  const record = Object.fromEntries(Object.entries(data));
  if (typeof record.remoteId === "string" && record.remoteId.trim()) {
    return record.remoteId.trim();
  }
  if (typeof record.id === "string" && record.id.trim()) {
    return record.id.trim();
  }
  if (typeof record.id === "number") {
    return String(record.id);
  }

  return null;
}

async function callRemoteJson(
  url: string,
  secret: string,
  method: "POST" | "PUT",
  body: unknown,
) {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const contentType = response.headers.get("content-type") ?? "";
  const data = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : await response.text().catch(() => null);

  return {
    ok: response.ok,
    status: response.status,
    data,
  };
}

async function resolveApplicableAgreement(
  params: {
    customerId: number;
    organizationId: string;
    serviceId: number;
    unitId: number;
    referenceDate?: Date;
  },
  executor: FinanceDbExecutor,
): Promise<AgreementResolution> {
  const referenceDate = params.referenceDate ?? new Date();
  const agreements = await executor
    .select()
    .from(commercialAgreement)
    .where(
      and(
        eq(commercialAgreement.organizationId, params.organizationId),
        eq(commercialAgreement.customerId, params.customerId),
        eq(
          commercialAgreement.status,
          "ACTIVE" satisfies CommercialAgreementStatus,
        ),
        lte(commercialAgreement.effectiveFrom, referenceDate),
        or(
          isNull(commercialAgreement.effectiveTo),
          gte(commercialAgreement.effectiveTo, referenceDate),
        ),
      ),
    )
    .orderBy(
      desc(commercialAgreement.effectiveFrom),
      desc(commercialAgreement.id),
    );

  for (const agreement of agreements) {
    const scopedUnits = await executor
      .select({ unitId: commercialAgreementUnitScope.unitId })
      .from(commercialAgreementUnitScope)
      .where(eq(commercialAgreementUnitScope.agreementId, agreement.id));

    if (
      scopedUnits.length > 0 &&
      !scopedUnits.some((entry) => entry.unitId === params.unitId)
    ) {
      continue;
    }

    const terms = await executor
      .select()
      .from(commercialAgreementServiceTerm)
      .where(
        and(
          eq(commercialAgreementServiceTerm.agreementId, agreement.id),
          eq(commercialAgreementServiceTerm.serviceId, params.serviceId),
          eq(commercialAgreementServiceTerm.isActive, true),
          or(
            eq(commercialAgreementServiceTerm.unitId, params.unitId),
            isNull(commercialAgreementServiceTerm.unitId),
          ),
        ),
      )
      .orderBy(desc(commercialAgreementServiceTerm.unitId));

    const exactTerm =
      terms.find((term) => term.unitId === params.unitId) ??
      terms.find((term) => term.unitId === null) ??
      null;

    if (!exactTerm) {
      continue;
    }

    return { agreement, term: exactTerm };
  }

  return null;
}

export async function loadCustomerActiveCommercialAgreement(
  organizationId: string,
  customerId: number,
  executor?: FinanceDbExecutor,
): Promise<ActiveCommercialAgreementSummary | null> {
  const runner = executor ?? db;
  const now = new Date();

  const [agreement] = await runner
    .select({
      id: commercialAgreement.id,
      agreementCode: commercialAgreement.agreementCode,
      title: commercialAgreement.title,
      effectiveFrom: commercialAgreement.effectiveFrom,
      effectiveTo: commercialAgreement.effectiveTo,
      currency: commercialAgreement.currency,
      defaultPaymentTermDays: commercialAgreement.defaultPaymentTermDays,
    })
    .from(commercialAgreement)
    .where(
      and(
        eq(commercialAgreement.organizationId, organizationId),
        eq(commercialAgreement.customerId, customerId),
        eq(
          commercialAgreement.status,
          "ACTIVE" satisfies CommercialAgreementStatus,
        ),
        lte(commercialAgreement.effectiveFrom, now),
        or(
          isNull(commercialAgreement.effectiveTo),
          gte(commercialAgreement.effectiveTo, now),
        ),
      ),
    )
    .orderBy(
      desc(commercialAgreement.effectiveFrom),
      desc(commercialAgreement.id),
    )
    .limit(1);

  if (!agreement) {
    return null;
  }

  return {
    ...agreement,
    effectiveFrom: agreement.effectiveFrom.toISOString(),
    effectiveTo: agreement.effectiveTo?.toISOString() ?? null,
  };
}

export function syncComplianceWithActiveAgreement(
  currentCompliance: CustomerCompliance | null | undefined,
  activeAgreement: ActiveCommercialAgreementSummary | null,
): CustomerCompliance {
  const baseCompliance: CustomerCompliance = {
    qualificationStatus: currentCompliance?.qualificationStatus ?? "pending",
    qualityRequirementsAcknowledged:
      currentCompliance?.qualityRequirementsAcknowledged ?? false,
    qualificationDate: currentCompliance?.qualificationDate,
    qualificationExpiresAt: currentCompliance?.qualificationExpiresAt,
    contractAgreementId: currentCompliance?.contractAgreementId,
    contractNumber: currentCompliance?.contractNumber,
    contractSignedAt: currentCompliance?.contractSignedAt,
    contractExpiresAt: currentCompliance?.contractExpiresAt,
    qualityRequirementsAcknowledgedAt:
      currentCompliance?.qualityRequirementsAcknowledgedAt,
    notes: currentCompliance?.notes,
  };

  if (!activeAgreement) {
    return {
      ...baseCompliance,
      contractAgreementId: undefined,
      contractNumber: undefined,
      contractSignedAt: undefined,
      contractExpiresAt: undefined,
      qualityRequirementsAcknowledged: false,
      qualityRequirementsAcknowledgedAt: undefined,
    };
  }

  const agreementChanged =
    baseCompliance.contractAgreementId !== activeAgreement.id;

  return {
    ...baseCompliance,
    contractAgreementId: activeAgreement.id,
    contractNumber: getAgreementDisplayCode(activeAgreement),
    contractExpiresAt: activeAgreement.effectiveTo ?? undefined,
    ...(agreementChanged
      ? {
          contractSignedAt: undefined,
          qualityRequirementsAcknowledged: false,
          qualityRequirementsAcknowledgedAt: undefined,
        }
      : {}),
  };
}

export async function ensureJobCommercialSnapshot(
  params: {
    actorUserId?: string | null;
    customerId: number;
    jobId: number;
    organizationId: string;
    serviceId: number;
    unitId: number;
  },
  executor?: FinanceDbExecutor,
) {
  const runner = executor ?? db;
  const [existing] = await runner
    .select()
    .from(jobCommercialSnapshot)
    .where(eq(jobCommercialSnapshot.jobId, params.jobId))
    .limit(1);

  if (existing) {
    return existing;
  }

  const [serviceData] = await runner
    .select({
      id: service.id,
      name: service.name,
      price: service.price,
      currency: service.currency,
    })
    .from(service)
    .where(
      and(
        eq(service.id, params.serviceId),
        eq(service.organizationId, params.organizationId),
      ),
    )
    .limit(1);

  if (!serviceData) {
    throw new Error("Servico nao encontrado para snapshot comercial");
  }

  const agreementResolution = await resolveApplicableAgreement(
    {
      organizationId: params.organizationId,
      customerId: params.customerId,
      unitId: params.unitId,
      serviceId: params.serviceId,
    },
    runner,
  );

  const [snapshot] = await runner
    .insert(jobCommercialSnapshot)
    .values({
      jobId: params.jobId,
      organizationId: params.organizationId,
      customerId: params.customerId,
      unitId: params.unitId,
      serviceId: params.serviceId,
      agreementId: agreementResolution?.agreement.id ?? null,
      sourceType: agreementResolution ? "AGREEMENT" : "SERVICE_CATALOG",
      serviceName: serviceData.name,
      priceCents:
        agreementResolution?.term?.priceCents ?? serviceData.price ?? null,
      currency: agreementResolution?.term?.currency ?? serviceData.currency,
      paymentTermDays:
        agreementResolution?.agreement.defaultPaymentTermDays ??
        DEFAULT_FINANCIAL_PAYMENT_TERM_DAYS,
      capturedBySystemVersion: OPERATIONAL_FINANCE_SYSTEM_VERSION,
    })
    .returning();

  if (!snapshot) {
    throw new Error("Falha ao criar snapshot comercial");
  }

  if (params.actorUserId) {
    await runner.insert(financialAuditLog).values({
      organizationId: params.organizationId,
      entityType: "snapshot",
      entityId: String(snapshot.id),
      action: "snapshot.create",
      changes: {
        jobId: params.jobId,
        sourceType: snapshot.sourceType,
        agreementId: snapshot.agreementId,
        priceCents: snapshot.priceCents,
        paymentTermDays: snapshot.paymentTermDays,
      },
      performedBy: params.actorUserId,
    });
  }

  return snapshot;
}

export async function ensureJobCommercialSnapshotFromJob(
  params: {
    actorUserId?: string | null;
    jobId: number;
    organizationId: string;
  },
  executor?: FinanceDbExecutor,
) {
  const runner = executor ?? db;
  const [job] = await runner
    .select({
      id: calibrationJob.id,
      customerId: calibrationJob.customerId,
      unitId: calibrationJob.unitId,
      serviceId: calibrationJob.serviceId,
    })
    .from(calibrationJob)
    .where(
      and(
        eq(calibrationJob.id, params.jobId),
        eq(calibrationJob.organizationId, params.organizationId),
      ),
    )
    .limit(1);

  if (!job) {
    throw new Error("Job nao encontrado para snapshot comercial");
  }

  return ensureJobCommercialSnapshot(
    {
      actorUserId: params.actorUserId,
      jobId: job.id,
      organizationId: params.organizationId,
      customerId: job.customerId,
      unitId: job.unitId,
      serviceId: job.serviceId,
    },
    runner,
  );
}

export async function loadJobFinancialContexts(
  organizationId: string,
  jobIds: number[],
) {
  if (jobIds.length === 0) {
    return new Map<number, JobFinancialContext>();
  }

  const rows = await db
    .select({
      jobId: billingDocumentItem.jobId,
      documentId: billingDocument.id,
      documentNumber: billingDocument.documentNumber,
      documentStatus: billingDocument.status,
      dueDate: billingDocument.dueDate,
      installmentStatus: receivableInstallment.status,
    })
    .from(billingDocumentItem)
    .innerJoin(
      billingDocument,
      eq(billingDocumentItem.documentId, billingDocument.id),
    )
    .leftJoin(
      receivableInstallment,
      eq(receivableInstallment.documentId, billingDocument.id),
    )
    .where(
      and(
        eq(billingDocument.organizationId, organizationId),
        inArray(billingDocumentItem.jobId, jobIds),
      ),
    )
    .orderBy(desc(billingDocument.createdAt));

  const now = new Date();
  const result = new Map<number, JobFinancialContext>();

  for (const row of rows) {
    if (!row.jobId || result.has(row.jobId)) {
      continue;
    }

    const financialStatus =
      row.documentStatus === "VOID"
        ? "UNBILLED"
        : row.documentStatus === "ISSUED" &&
            row.dueDate < now &&
            row.installmentStatus !== "PAID"
          ? "OVERDUE"
          : row.documentStatus;

    result.set(row.jobId, {
      documentId: financialStatus === "UNBILLED" ? null : row.documentId,
      financialStatus,
      invoiceDocumentNumber:
        financialStatus === "UNBILLED" ? null : row.documentNumber,
      invoiceEligibility: financialStatus === "UNBILLED",
      overdueBalanceFlag: financialStatus === "OVERDUE",
    });
  }

  for (const jobId of jobIds) {
    if (!result.has(jobId)) {
      result.set(jobId, {
        documentId: null,
        financialStatus: "UNBILLED",
        invoiceDocumentNumber: null,
        invoiceEligibility: true,
        overdueBalanceFlag: false,
      });
    }
  }

  return result;
}

export async function loadCustomerFinancialSummary(
  organizationId: string,
  customerId: number,
): Promise<CustomerFinancialSummary> {
  const rows = await db
    .select({
      documentStatus: billingDocument.status,
      totalCents: billingDocument.totalCents,
      dueDate: billingDocument.dueDate,
    })
    .from(billingDocument)
    .where(
      and(
        eq(billingDocument.organizationId, organizationId),
        eq(billingDocument.customerId, customerId),
        inArray(billingDocument.status, ["ISSUED", "OVERDUE", "PAID"]),
      ),
    );

  const now = new Date();
  let openDocumentsCount = 0;
  let overdueDocumentsCount = 0;
  let openBalanceCents = 0;
  let overdueBalanceCents = 0;

  for (const row of rows) {
    if (row.documentStatus === "PAID") {
      continue;
    }

    openDocumentsCount += 1;
    openBalanceCents += row.totalCents;

    if (row.documentStatus === "OVERDUE" || row.dueDate < now) {
      overdueDocumentsCount += 1;
      overdueBalanceCents += row.totalCents;
    }
  }

  return {
    openDocumentsCount,
    overdueDocumentsCount,
    openBalanceCents,
    overdueBalanceCents,
    overdueBalanceFlag: overdueDocumentsCount > 0,
  };
}

async function getNextBillingDocumentSequence(
  organizationId: string,
  year: number,
  executor: FinanceDbExecutor,
) {
  const prefix = `FIN-${year}-`;
  const sequenceSql = sql<number>`coalesce(cast(substring(${billingDocument.documentNumber} from '[0-9]+$') as integer), 0)`;

  await executor.execute(
    sql`select pg_advisory_xact_lock(hashtext(${organizationId}), ${year} + 1000)`,
  );

  const [result] = await executor
    .select({ sequence: sequenceSql })
    .from(billingDocument)
    .where(
      and(
        eq(billingDocument.organizationId, organizationId),
        ilike(billingDocument.documentNumber, `${prefix}%`),
      ),
    )
    .orderBy(desc(sequenceSql))
    .limit(1)
    .for("update");

  return (result?.sequence ?? 0) + 1;
}

export async function generateBillingDocumentNumber(
  organizationId: string,
  executor?: FinanceDbExecutor,
) {
  const year = new Date().getFullYear();
  const sequence = executor
    ? await getNextBillingDocumentSequence(organizationId, year, executor)
    : await db.transaction((tx) =>
        getNextBillingDocumentSequence(organizationId, year, tx),
      );

  return `FIN-${year}-${sequence.toString().padStart(4, "0")}`;
}

export async function loadBillingDocumentExportPayload(
  organizationId: string,
  documentId: number,
): Promise<IntegrationBillingDocumentPayload | null> {
  const [document] = await db
    .select({
      id: billingDocument.id,
      documentNumber: billingDocument.documentNumber,
      organizationId: billingDocument.organizationId,
      unitId: billingDocument.unitId,
      unitName: organizationUnit.name,
      customerId: billingDocument.customerId,
      customerName: customer.name,
      totalCents: billingDocument.totalCents,
      currency: billingDocument.currency,
      issueDate: billingDocument.issueDate,
      dueDate: billingDocument.dueDate,
      status: billingDocument.status,
    })
    .from(billingDocument)
    .innerJoin(customer, eq(billingDocument.customerId, customer.id))
    .innerJoin(
      organizationUnit,
      eq(billingDocument.unitId, organizationUnit.id),
    )
    .where(
      and(
        eq(billingDocument.id, documentId),
        eq(billingDocument.organizationId, organizationId),
      ),
    )
    .limit(1);

  if (!document) {
    return null;
  }

  const items = await db
    .select({
      id: billingDocumentItem.id,
      description: billingDocumentItem.description,
      quantity: billingDocumentItem.quantity,
      unitPriceCents: billingDocumentItem.unitPriceCents,
      totalCents: billingDocumentItem.totalCents,
      materialId: billingDocumentItem.materialId,
      jobDisplayId: calibrationJob.jobId,
      serviceId: calibrationJob.serviceId,
    })
    .from(billingDocumentItem)
    .leftJoin(calibrationJob, eq(billingDocumentItem.jobId, calibrationJob.id))
    .where(eq(billingDocumentItem.documentId, document.id))
    .orderBy(billingDocumentItem.sortOrder, billingDocumentItem.id);

  return {
    externalId: `billing_document:${document.id}`,
    documentNumber: document.documentNumber,
    organizationId: document.organizationId,
    unitId: document.unitId,
    unitName: document.unitName,
    customerExternalId: `customer:${document.customerId}`,
    customerName: document.customerName,
    totalCents: document.totalCents,
    currency: document.currency,
    issueDate: document.issueDate?.toISOString?.() ?? null,
    dueDate: document.dueDate?.toISOString?.() ?? null,
    status: toLowerBillingDocumentStatus(document.status),
    items: items.map((item) => ({
      lineId: `billing_document_item:${item.id}`,
      jobId: item.jobDisplayId ?? null,
      // Calibration lines resolve via the job's service; SO part lines via
      // the material catalog. The ERP adapter maps these external ids to the
      // linked remote service/product — a product line on the exported sale
      // is what makes Conta Azul decrement stock on billing.
      catalogItemExternalId: item.serviceId
        ? `service:${item.serviceId}`
        : item.materialId
          ? `material:${item.materialId}`
          : null,
      description: item.description,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      totalCents: item.totalCents,
    })),
  };
}

export async function loadBillingDocumentPayloadsForIntegration(
  organizationId: string,
  limit: number,
) {
  const documents = await db
    .select({
      id: billingDocument.id,
    })
    .from(billingDocument)
    .where(
      and(
        eq(billingDocument.organizationId, organizationId),
        inArray(billingDocument.status, ["ISSUED", "PAID", "OVERDUE"]),
      ),
    )
    .orderBy(desc(billingDocument.issueDate), desc(billingDocument.createdAt))
    .limit(limit);

  const payloads = await Promise.all(
    documents.map((document) =>
      loadBillingDocumentExportPayload(organizationId, document.id),
    ),
  );

  return payloads.filter(
    (payload): payload is IntegrationBillingDocumentPayload => payload !== null,
  );
}

export async function exportBillingDocumentToPrimaryIntegration(params: {
  documentId: number;
  env: IntegrationsEnv;
  organizationId: string;
}) {
  const [record] = await db
    .select({
      integrationId: organizationIntegration.id,
      provider: organizationIntegration.provider,
      connectionId: integrationConnection.id,
      encryptedSecret: integrationConnection.encryptedSecret,
      secretIv: integrationConnection.secretIv,
      config: integrationConnection.config,
    })
    .from(organizationIntegration)
    .innerJoin(
      integrationConnection,
      eq(integrationConnection.integrationId, organizationIntegration.id),
    )
    .where(
      and(
        eq(organizationIntegration.organizationId, params.organizationId),
        eq(organizationIntegration.type, "financial_erp"),
        eq(organizationIntegration.status, "ACTIVE"),
      ),
    )
    .orderBy(desc(organizationIntegration.updatedAt))
    .limit(1);

  if (!record) {
    throw new Error("Nenhuma integração ERP ativa encontrada");
  }

  const payload = await loadBillingDocumentExportPayload(
    params.organizationId,
    params.documentId,
  );

  if (!payload) {
    throw new Error("Documento financeiro nao encontrado");
  }

  const [existingLink] = await db
    .select({
      id: integrationObjectLink.id,
      remoteEntityId: integrationObjectLink.remoteEntityId,
    })
    .from(integrationObjectLink)
    .where(
      and(
        eq(integrationObjectLink.integrationId, record.integrationId),
        eq(integrationObjectLink.target, "billing_document"),
        eq(integrationObjectLink.localEntityId, payload.externalId),
      ),
    )
    .limit(1);

  let remoteEntityId: string | null = null;

  if (record.provider === "generic_http") {
    const config = normalizeGenericFinancialErpConfig(record.config);
    const secret = decryptIntegrationSecret(
      record.encryptedSecret,
      record.secretIv,
      params.env,
    );
    const mappedPayload = applyIntegrationMappings(
      "billing_document",
      Object.fromEntries(Object.entries(payload)),
      config.mappings.billing_document,
    );
    const remoteUrl = existingLink?.remoteEntityId
      ? `${config.baseUrl}${config.billingDocumentPath}/${encodeURIComponent(existingLink.remoteEntityId)}`
      : `${config.baseUrl}${config.billingDocumentPath}`;
    const remoteMethod = existingLink?.remoteEntityId ? "PUT" : "POST";
    const response = await callRemoteJson(
      remoteUrl,
      secret,
      remoteMethod,
      mappedPayload,
    );

    if (!response.ok) {
      await db
        .update(billingDocument)
        .set({
          exportStatus: "FAILED",
          updatedAt: new Date(),
        })
        .where(eq(billingDocument.id, params.documentId));

      await writeFinanceIntegrationEvent({
        integrationId: record.integrationId,
        organizationId: params.organizationId,
        level: "error",
        event: "finance.document_export.failed",
        message: `Falha ao exportar documento financeiro ${payload.externalId}`,
        details: {
          documentId: params.documentId,
          status: response.status,
        },
      });

      throw new Error(
        `Falha ao exportar documento: remoto respondeu ${response.status}`,
      );
    }

    remoteEntityId = extractRemoteId(response.data);
  } else {
    const tokenBundle = parseContaAzulTokenBundle(
      decryptIntegrationSecret(
        record.encryptedSecret,
        record.secretIv,
        params.env,
      ),
    );
    const config = normalizeContaAzulConnectionConfig(record.config);
    if (!config.enabledTargets.billingDocuments) {
      throw new Error("Sincronização de faturamento Conta Azul desativada");
    }
    const adapter = createFinancialErpAdapter({
      provider: "conta_azul",
      integrationId: record.integrationId,
      organizationId: params.organizationId,
      config,
      accessToken: tokenBundle.accessToken,
      rateLimitKey: record.integrationId,
      links: {
        async getExistingRemoteId({ target, localEntityId }) {
          const [link] = await db
            .select({
              remoteEntityId: integrationObjectLink.remoteEntityId,
            })
            .from(integrationObjectLink)
            .where(
              and(
                eq(integrationObjectLink.integrationId, record.integrationId),
                eq(integrationObjectLink.target, target),
                eq(integrationObjectLink.localEntityId, localEntityId),
              ),
            )
            .limit(1);

          return link?.remoteEntityId ?? null;
        },
        async upsertLink({
          target,
          localEntityId,
          remoteEntityId: linkRemoteEntityId,
          remoteDisplayId,
          remoteEntityType,
          metadata,
        }) {
          const [link] = await db
            .select({ id: integrationObjectLink.id })
            .from(integrationObjectLink)
            .where(
              and(
                eq(integrationObjectLink.integrationId, record.integrationId),
                eq(integrationObjectLink.target, target),
                eq(integrationObjectLink.localEntityId, localEntityId),
              ),
            )
            .limit(1);

          if (link) {
            await db
              .update(integrationObjectLink)
              .set({
                remoteEntityId: linkRemoteEntityId,
                remoteDisplayId: remoteDisplayId ?? linkRemoteEntityId,
                remoteEntityType: remoteEntityType ?? null,
                metadata: metadata ?? null,
                lastSyncedAt: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(integrationObjectLink.id, link.id));
            return;
          }

          await db.insert(integrationObjectLink).values({
            id: crypto.randomUUID(),
            integrationId: record.integrationId,
            organizationId: params.organizationId,
            target,
            localEntityId,
            remoteEntityId: linkRemoteEntityId,
            remoteDisplayId: remoteDisplayId ?? linkRemoteEntityId,
            remoteEntityType: remoteEntityType ?? null,
            metadata: metadata ?? null,
            lastSyncedAt: new Date(),
          });
        },
      },
      async onUnauthorized() {
        try {
          const refreshed = await refreshContaAzulAccessToken(
            getContaAzulOAuthConfig(params.env),
            {
              refreshToken: tokenBundle.refreshToken,
            },
          );
          const encrypted = encryptIntegrationSecret(
            serializeContaAzulTokenBundle(refreshed),
            params.env,
          );
          const refreshedConfig = normalizeContaAzulConnectionConfig({
            ...config,
            accessTokenExpiresAt: refreshed.expiresAt,
            scopes: refreshed.scopes,
          });

          await db
            .update(integrationConnection)
            .set({
              credentialType: "oauth2",
              config: refreshedConfig,
              encryptedSecret: encrypted.encryptedSecret,
              secretIv: encrypted.secretIv,
              updatedAt: new Date(),
            })
            .where(eq(integrationConnection.id, record.connectionId));

          return refreshed.accessToken;
        } catch (error) {
          const failure = buildContaAzulRefreshFailurePolicy(error);

          await db
            .update(organizationIntegration)
            .set({
              status: failure.status,
              lastValidationError: failure.message,
              updatedAt: new Date(),
            })
            .where(eq(organizationIntegration.id, record.integrationId));

          throw new Error(failure.message);
        }
      },
    });

    try {
      const exported = await adapter.exportBillingDocument(payload);
      remoteEntityId = exported.remoteEntityId;
    } catch (error) {
      await db
        .update(billingDocument)
        .set({
          exportStatus: "FAILED",
          updatedAt: new Date(),
        })
        .where(eq(billingDocument.id, params.documentId));

      const message =
        error instanceof Error
          ? error.message
          : "Falha ao exportar documento para Conta Azul";

      await writeFinanceIntegrationEvent({
        integrationId: record.integrationId,
        organizationId: params.organizationId,
        level: "error",
        event: "finance.document_export.failed",
        message: `Falha ao exportar documento financeiro ${payload.externalId}`,
        details: {
          documentId: params.documentId,
          provider: "conta_azul",
          error: message,
        },
      });

      throw error;
    }
  }

  if (record.provider === "generic_http") {
    if (existingLink) {
      await db
        .update(integrationObjectLink)
        .set({
          remoteEntityId,
          remoteDisplayId: remoteEntityId,
          remoteEntityType: "billing_document",
          lastSyncedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(integrationObjectLink.id, existingLink.id));
    } else {
      await db.insert(integrationObjectLink).values({
        id: crypto.randomUUID(),
        integrationId: record.integrationId,
        organizationId: params.organizationId,
        target: "billing_document",
        localEntityId: payload.externalId,
        remoteEntityId,
        remoteDisplayId: remoteEntityId,
        remoteEntityType: "billing_document",
        lastSyncedAt: new Date(),
      });
    }
  }

  await db
    .update(billingDocument)
    .set({
      exportStatus: "EXPORTED",
      exportedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(billingDocument.id, params.documentId));

  await writeFinanceIntegrationEvent({
    integrationId: record.integrationId,
    organizationId: params.organizationId,
    level: "info",
    event: "finance.document_export.completed",
    message: `Documento financeiro ${payload.externalId} exportado com sucesso`,
    details: {
      documentId: params.documentId,
      remoteEntityId,
    },
  });

  return payload;
}

export function buildDefaultDueDate(
  paymentTermDays = DEFAULT_FINANCIAL_PAYMENT_TERM_DAYS,
) {
  return calculateFinancialDueDate(new Date(), paymentTermDays);
}

// =============================================================================
// SEND TO FINANCE — turn a completed service order into an issued billing
// document and export it through the configured financial provider. Reuses the
// existing snapshot/number/installment/export primitives so the write path
// stays consistent with the document-centric billing flow.
// =============================================================================

type FinanceUnitScope = Parameters<typeof buildUnitScopeCondition>[1];

export interface SendServiceOrderResult {
  serviceOrderId: number;
  ok: boolean;
  billingDocumentId: number | null;
  error: string | null;
}

export async function sendServiceOrderToFinance(params: {
  organizationId: string;
  serviceOrderId: number;
  actorUserId: string;
  scope: FinanceUnitScope;
  env: IntegrationsEnv;
}): Promise<SendServiceOrderResult> {
  const { organizationId, serviceOrderId, actorUserId, scope, env } = params;
  try {
    const [order] = await db
      .select({
        id: serviceOrder.id,
        number: serviceOrder.serviceOrderNumber,
        status: serviceOrder.status,
        closingReason: serviceOrder.closingReason,
        customerId: serviceOrder.customerId,
        unitId: serviceOrder.unitId,
        amountApprovedCents: serviceOrder.totalApprovedCents,
        amountQuotedCents: serviceOrder.totalQuotedCents,
        billingDocumentId: serviceOrder.billingDocumentId,
        taxId: customer.taxId,
        email: customer.email,
        address: customer.address,
      })
      .from(serviceOrder)
      .innerJoin(customer, eq(serviceOrder.customerId, customer.id))
      .where(
        and(
          eq(serviceOrder.organizationId, organizationId),
          eq(serviceOrder.id, serviceOrderId),
          buildUnitScopeCondition(serviceOrder.unitId, scope),
        ),
      )
      .limit(1);

    if (!order) {
      throw new Error("Ordem de serviço não encontrada");
    }
    if (!isServiceOrderBillable(order.status, order.closingReason)) {
      throw new Error("Ordem de serviço não está pronta para faturamento");
    }

    // Reuse an existing (non-void) billing document if the order already has one.
    let existingDoc: { id: number; status: BillingDocumentStatus } | null =
      null;
    if (order.billingDocumentId) {
      const [doc] = await db
        .select({ id: billingDocument.id, status: billingDocument.status })
        .from(billingDocument)
        .where(
          and(
            eq(billingDocument.id, order.billingDocumentId),
            ne(billingDocument.status, "VOID"),
          ),
        )
        .limit(1);
      existingDoc = doc ?? null;
    }

    let documentId: number;

    if (existingDoc) {
      documentId = existingDoc.id;
      if (existingDoc.status === "DRAFT") {
        await issueDraftBillingDocument({
          organizationId,
          documentId,
          actorUserId,
        });
      }
    } else {
      const jobs = await db
        .select({
          id: calibrationJob.id,
          jobId: calibrationJob.jobId,
          status: calibrationJob.status,
        })
        .from(serviceOrderCertificateLink)
        .innerJoin(
          calibrationJob,
          eq(serviceOrderCertificateLink.certificateJobId, calibrationJob.id),
        )
        .where(eq(serviceOrderCertificateLink.serviceOrderId, order.id));

      const amountCents =
        order.amountApprovedCents > 0
          ? order.amountApprovedCents
          : order.amountQuotedCents;

      const blockers = evaluateOrderBlockers({
        customer: {
          taxId: order.taxId,
          email: order.email,
          address: order.address,
        },
        certificateJobStatuses: jobs.map((job) => job.status),
        amountCents,
      });
      if (blockers.length > 0) {
        throw new Error(blockers[0]!.label);
      }

      const approvedJobs = jobs.filter(
        (job) => job.status === "APPROVED" || job.status === "SUPERSEDED",
      );

      const snapshots: Awaited<
        ReturnType<typeof ensureJobCommercialSnapshotFromJob>
      >[] = [];
      for (const job of approvedJobs) {
        snapshots.push(
          await ensureJobCommercialSnapshotFromJob(
            { actorUserId, jobId: job.id, organizationId },
            undefined,
          ),
        );
      }

      const jobSubtotalCents = snapshots.reduce(
        (sum, snapshot) => sum + (snapshot.priceCents ?? 0),
        0,
      );
      // Repair-only orders may have no certificate jobs; fall back to the
      // service order's own pricing snapshot so they can still be billed.
      const useServiceOrderLine =
        approvedJobs.length === 0 || jobSubtotalCents <= 0;
      const subtotalCents = useServiceOrderLine
        ? amountCents
        : jobSubtotalCents;
      const currency = snapshots[0]?.currency ?? "BRL";
      const paymentTermDays =
        Math.max(
          ...snapshots.map((snapshot) => snapshot.paymentTermDays),
          DEFAULT_FINANCIAL_PAYMENT_TERM_DAYS,
        ) || DEFAULT_FINANCIAL_PAYMENT_TERM_DAYS;

      documentId = await db.transaction(async (tx) => {
        const issueDate = new Date();
        const documentNumber = await generateBillingDocumentNumber(
          organizationId,
          tx,
        );
        const dueDate = calculateFinancialDueDate(issueDate, paymentTermDays);

        const [document] = await tx
          .insert(billingDocument)
          .values({
            organizationId,
            customerId: order.customerId,
            unitId: order.unitId,
            agreementId:
              snapshots.find((snapshot) => snapshot.agreementId)?.agreementId ??
              null,
            documentNumber,
            status: "ISSUED",
            issueDate,
            dueDate,
            currency,
            subtotalCents,
            discountCents: 0,
            totalCents: subtotalCents,
            issuedBy: actorUserId,
            createdBy: actorUserId,
            updatedBy: actorUserId,
          })
          .returning();

        if (!document) {
          throw new Error("Falha ao criar documento financeiro");
        }

        if (useServiceOrderLine) {
          await tx.insert(billingDocumentItem).values({
            documentId: document.id,
            jobId: null,
            serviceOrderId: order.id,
            description: `OS ${order.number}`,
            quantity: 1,
            unitPriceCents: subtotalCents,
            totalCents: subtotalCents,
            sortOrder: 0,
          });
        } else {
          await tx.insert(billingDocumentItem).values(
            approvedJobs.map((job, index) => ({
              documentId: document.id,
              jobId: job.id,
              serviceOrderId: order.id,
              jobCommercialSnapshotId: snapshots[index]?.id ?? null,
              description: snapshots[index]?.serviceName ?? job.jobId,
              quantity: 1,
              unitPriceCents: snapshots[index]?.priceCents ?? 0,
              totalCents: snapshots[index]?.priceCents ?? 0,
              sortOrder: index,
            })),
          );
        }

        await tx.insert(receivableInstallment).values({
          documentId: document.id,
          installmentNumber: 1,
          status: "OPEN",
          dueDate,
          amountCents: subtotalCents,
          currency,
        });

        await tx
          .update(serviceOrder)
          .set({ billingDocumentId: document.id, updatedAt: issueDate })
          .where(eq(serviceOrder.id, order.id));

        await tx.insert(financialAuditLog).values({
          organizationId,
          entityType: "service_order",
          entityId: String(order.id),
          action: "service_order.sent_to_finance",
          changes: {
            billingDocumentId: document.id,
            subtotalCents,
            jobIds: approvedJobs.map((job) => job.id),
          },
          performedBy: actorUserId,
        });

        return document.id;
      });
    }

    await exportBillingDocumentToPrimaryIntegration({
      organizationId,
      documentId,
      env,
    });

    return {
      serviceOrderId,
      ok: true,
      billingDocumentId: documentId,
      error: null,
    };
  } catch (error) {
    return {
      serviceOrderId,
      ok: false,
      billingDocumentId: null,
      error:
        error instanceof Error
          ? error.message
          : "Falha ao enviar a ordem para o financeiro",
    };
  }
}

/** Issue an existing DRAFT billing document (number, status, installment). */
async function issueDraftBillingDocument(params: {
  organizationId: string;
  documentId: number;
  actorUserId: string;
}) {
  const { organizationId, documentId, actorUserId } = params;
  const [existing] = await db
    .select({
      dueDate: billingDocument.dueDate,
      totalCents: billingDocument.totalCents,
      currency: billingDocument.currency,
    })
    .from(billingDocument)
    .where(eq(billingDocument.id, documentId))
    .limit(1);
  if (!existing) {
    throw new Error("Documento financeiro não encontrado");
  }

  await db.transaction(async (tx) => {
    const issueDate = new Date();
    const documentNumber = await generateBillingDocumentNumber(
      organizationId,
      tx,
    );
    const effectiveDueDate =
      existing.dueDate instanceof Date &&
      existing.dueDate.getTime() > issueDate.getTime()
        ? existing.dueDate
        : calculateFinancialDueDate(
            issueDate,
            DEFAULT_FINANCIAL_PAYMENT_TERM_DAYS,
          );

    await tx
      .update(billingDocument)
      .set({
        documentNumber,
        status: "ISSUED",
        issueDate,
        dueDate: effectiveDueDate,
        issuedBy: actorUserId,
        updatedBy: actorUserId,
        updatedAt: issueDate,
      })
      .where(eq(billingDocument.id, documentId));

    const [existingInstallment] = await tx
      .select({ id: receivableInstallment.id })
      .from(receivableInstallment)
      .where(eq(receivableInstallment.documentId, documentId))
      .limit(1);

    if (!existingInstallment) {
      await tx.insert(receivableInstallment).values({
        documentId,
        installmentNumber: 1,
        status: "OPEN",
        dueDate: effectiveDueDate,
        amountCents: existing.totalCents,
        currency: existing.currency,
      });
    }
  });
}

export async function sendServiceOrdersToFinance(params: {
  organizationId: string;
  serviceOrderIds: number[];
  actorUserId: string;
  scope: FinanceUnitScope;
  env: IntegrationsEnv;
}): Promise<SendServiceOrderResult[]> {
  const results: SendServiceOrderResult[] = [];
  for (const serviceOrderId of params.serviceOrderIds) {
    results.push(
      await sendServiceOrderToFinance({
        organizationId: params.organizationId,
        serviceOrderId,
        actorUserId: params.actorUserId,
        scope: params.scope,
        env: params.env,
      }),
    );
  }
  return results;
}
