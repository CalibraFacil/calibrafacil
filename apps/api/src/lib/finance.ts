import { db } from "@calibra-facil/db";
import {
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
} from "@calibra-facil/db/schema";
import {
  type BillingDocumentStatus,
  type CommercialAgreementStatus,
  DEFAULT_FINANCIAL_PAYMENT_TERM_DAYS,
  applyIntegrationMappings,
  calculateFinancialDueDate,
  normalizeGenericFinancialErpConfig,
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
  or,
  sql,
} from "drizzle-orm";
import type { IntegrationsEnv } from "./integrations";
import { decryptPassword } from "@calibra-facil/signing";

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
      jobDisplayId: calibrationJob.jobId,
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

  const remoteEntityId = extractRemoteId(response.data);

  if (existingLink) {
    await db
      .update(integrationObjectLink)
      .set({
        remoteEntityId,
        remoteDisplayId: remoteEntityId,
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
      lastSyncedAt: new Date(),
    });
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
