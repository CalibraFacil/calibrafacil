import { db } from "@calibra-facil/db";
import {
  asset,
  calibrationJob,
  commercialAgreement,
  commercialAgreementServiceTerm,
  customer,
  material,
  organizationUnit,
  service,
  serviceOrder,
  serviceOrderExecution,
  serviceOrderExecutionItem,
} from "@calibra-facil/db/schema";
import {
  normalizeContaAzulConnectionConfig,
  type IntegrationPayablePayload,
  type IntegrationBillingDocumentPayload,
  type IntegrationCatalogItemPayload,
  type IntegrationContractPayload,
  type IntegrationServiceOrderPayload,
} from "@calibra-facil/shared";
import { and, desc, eq, gt, inArray, isNotNull } from "drizzle-orm";
import { loadBillingDocumentPayloadsForIntegration } from "../../lib/finance";
import { buildPessoaExternalId } from "./payloads-parties";

export async function loadServiceOrderPayloads(
  organizationId: string,
  limit: number,
): Promise<IntegrationServiceOrderPayload[]> {
  const rows = await db
    .select({
      id: calibrationJob.id,
      unitId: calibrationJob.unitId,
      unitName: organizationUnit.name,
      jobId: calibrationJob.jobId,
      status: calibrationJob.status,
      customerId: customer.id,
      customerName: customer.name,
      serviceId: service.id,
      assetName: asset.name,
      assetTag: asset.tag,
      serviceName: service.name,
      servicePrice: service.price,
      serviceCurrency: service.currency,
      performedAt: calibrationJob.performedAt,
      approvedAt: calibrationJob.approvedAt,
      updatedAt: calibrationJob.updatedAt,
    })
    .from(calibrationJob)
    .leftJoin(customer, eq(calibrationJob.customerId, customer.id))
    .leftJoin(asset, eq(calibrationJob.assetId, asset.id))
    .leftJoin(service, eq(calibrationJob.serviceId, service.id))
    .leftJoin(organizationUnit, eq(calibrationJob.unitId, organizationUnit.id))
    .where(
      and(
        eq(calibrationJob.organizationId, organizationId),
        inArray(calibrationJob.status, [
          "DRAFT",
          "IN_PROGRESS",
          "REVIEW",
          "APPROVED",
          "SUPERSEDED",
        ]),
      ),
    )
    .limit(limit)
    .orderBy(desc(calibrationJob.updatedAt));

  return rows.map((row) => ({
    externalId: `service_order:${row.id}`,
    organizationId,
    unitId: row.unitId,
    unitName: row.unitName ?? null,
    jobId: row.jobId,
    status: row.status,
    customerExternalId: row.customerId ? `customer:${row.customerId}` : null,
    customerName: row.customerName ?? null,
    serviceExternalId: row.serviceId ? `service:${row.serviceId}` : null,
    assetName: row.assetName ?? null,
    assetTag: row.assetTag ?? null,
    serviceName: row.serviceName ?? null,
    servicePriceCents: row.servicePrice ?? null,
    currency: row.serviceCurrency ?? null,
    performedAt: row.performedAt?.toISOString?.() ?? null,
    approvedAt: row.approvedAt?.toISOString?.() ?? null,
    updatedAt: row.updatedAt?.toISOString?.() ?? null,
  }));
}

export async function loadBillingDocumentPayloads(
  organizationId: string,
  limit: number,
): Promise<IntegrationBillingDocumentPayload[]> {
  return loadBillingDocumentPayloadsForIntegration(organizationId, limit);
}

export async function loadPayablePayloads(
  organizationId: string,
  limit: number,
): Promise<IntegrationPayablePayload[]> {
  const rows = await db
    .select({
      serviceOrderId: serviceOrder.id,
      serviceOrderNumber: serviceOrder.serviceOrderNumber,
      supplierDocument: serviceOrder.thirdPartyDocument,
      itemId: serviceOrderExecutionItem.id,
      description: serviceOrderExecutionItem.description,
      quantity: serviceOrderExecutionItem.quantity,
      unitCostCents: serviceOrderExecutionItem.unitCostCents,
      finishedAt: serviceOrderExecution.finishedAt,
      updatedAt: serviceOrder.updatedAt,
    })
    .from(serviceOrderExecutionItem)
    .innerJoin(
      serviceOrderExecution,
      eq(serviceOrderExecutionItem.executionId, serviceOrderExecution.id),
    )
    .innerJoin(
      serviceOrder,
      eq(serviceOrderExecution.serviceOrderId, serviceOrder.id),
    )
    .where(
      and(
        eq(serviceOrder.organizationId, organizationId),
        isNotNull(serviceOrder.thirdPartyName),
        isNotNull(serviceOrderExecution.finishedAt),
        gt(serviceOrderExecutionItem.unitCostCents, 0),
      ),
    )
    .limit(limit)
    .orderBy(desc(serviceOrderExecution.finishedAt));

  return rows
    .map((row) => {
      const amountCents = Math.round(
        Number(row.quantity ?? 1) * Number(row.unitCostCents ?? 0),
      );
      const payableDate = row.finishedAt ?? row.updatedAt;

      return {
        externalId: `payable:service_order_execution_item:${row.itemId}`,
        organizationId,
        supplierExternalId: buildPessoaExternalId({
          role: "supplier",
          sourceId: row.serviceOrderId,
          document: row.supplierDocument,
        }),
        documentNumber: row.serviceOrderNumber,
        issueDate: payableDate.toISOString(),
        dueDate: payableDate.toISOString(),
        competenceDate: payableDate.toISOString(),
        amountCents,
        currency: "BRL",
        categoryId: null,
        costCenterId: null,
        notes: `Custo terceirizado da OS ${row.serviceOrderNumber}: ${row.description}`,
      } satisfies IntegrationPayablePayload;
    })
    .filter((payload) => payload.amountCents > 0);
}

export async function loadCatalogItemPayloads(
  organizationId: string,
  limit: number,
): Promise<IntegrationCatalogItemPayload[]> {
  const serviceRows = await db
    .select({
      id: service.id,
      name: service.name,
      description: service.description,
      price: service.price,
      currency: service.currency,
      isActive: service.isActive,
      updatedAt: service.updatedAt,
    })
    .from(service)
    .where(eq(service.organizationId, organizationId))
    .orderBy(desc(service.updatedAt))
    .limit(limit);

  // Materials (peças/materiais consumed on service orders) are the product
  // half of the Conta Azul catalog: /v1/servicos for services, /v1/produtos
  // for materials. externalId "material:{id}" keeps the object-link namespace
  // disjoint from "service:{id}".
  const materialRows = await db
    .select({
      id: material.id,
      name: material.name,
      description: material.description,
      sku: material.sku,
      unitPriceCents: material.unitPriceCents,
      isActive: material.isActive,
      updatedAt: material.updatedAt,
    })
    .from(material)
    .where(eq(material.organizationId, organizationId))
    .orderBy(desc(material.updatedAt))
    .limit(limit);

  const entries: Array<{
    updatedAt: Date;
    payload: IntegrationCatalogItemPayload;
  }> = [
    ...serviceRows.map((row) => ({
      updatedAt: row.updatedAt,
      payload: {
        externalId: `service:${row.id}`,
        organizationId,
        kind: "service" as const,
        code: `SVC-${row.id}`,
        name: row.name,
        description: row.description,
        priceCents: row.price,
        currency: row.currency,
        unitOfMeasureId: null,
        categoryId: null,
        fiscalMetadata: null,
        active: row.isActive,
      },
    })),
    ...materialRows.map((row) => ({
      updatedAt: row.updatedAt,
      payload: {
        externalId: `material:${row.id}`,
        organizationId,
        kind: "product" as const,
        code: row.sku ?? `MAT-${row.id}`,
        name: row.name,
        description: row.description,
        priceCents: row.unitPriceCents,
        currency: "BRL",
        unitOfMeasureId: null,
        categoryId: null,
        fiscalMetadata: null,
        active: row.isActive,
      },
    })),
  ];

  entries.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  return entries.slice(0, limit).map((entry) => entry.payload);
}

/**
 * Restrict catalog payloads to the kinds the Conta Azul connection actually
 * enabled: `enabledTargets.services` gates service items (/v1/servicos) and
 * `enabledTargets.products` gates product items (/v1/produtos, i.e. the
 * materials catalog). Applied before run/preview so a service-only setup
 * never creates surprise products (or noisy failed sync items) in the ERP.
 */
export function filterContaAzulCatalogPayloadsByEnabledKinds(
  config: ReturnType<typeof normalizeContaAzulConnectionConfig>,
  payloads: IntegrationCatalogItemPayload[],
): IntegrationCatalogItemPayload[] {
  return payloads.filter((payload) =>
    payload.kind === "service"
      ? config.enabledTargets.services
      : config.enabledTargets.products,
  );
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export async function loadContractPayloads(
  organizationId: string,
  limit: number,
): Promise<IntegrationContractPayload[]> {
  const agreements = await db
    .select({
      id: commercialAgreement.id,
      customerId: commercialAgreement.customerId,
      agreementCode: commercialAgreement.agreementCode,
      title: commercialAgreement.title,
      currency: commercialAgreement.currency,
      effectiveFrom: commercialAgreement.effectiveFrom,
      effectiveTo: commercialAgreement.effectiveTo,
      defaultPaymentTermDays: commercialAgreement.defaultPaymentTermDays,
      notes: commercialAgreement.notes,
    })
    .from(commercialAgreement)
    .where(
      and(
        eq(commercialAgreement.organizationId, organizationId),
        eq(commercialAgreement.status, "ACTIVE"),
      ),
    )
    .orderBy(desc(commercialAgreement.updatedAt))
    .limit(limit);

  const payloads: IntegrationContractPayload[] = [];
  for (const agreement of agreements) {
    const terms = await db
      .select({
        id: commercialAgreementServiceTerm.id,
        serviceId: commercialAgreementServiceTerm.serviceId,
        priceCents: commercialAgreementServiceTerm.priceCents,
        currency: commercialAgreementServiceTerm.currency,
        isActive: commercialAgreementServiceTerm.isActive,
        serviceName: service.name,
      })
      .from(commercialAgreementServiceTerm)
      .innerJoin(
        service,
        eq(commercialAgreementServiceTerm.serviceId, service.id),
      )
      .where(
        and(
          eq(commercialAgreementServiceTerm.agreementId, agreement.id),
          eq(commercialAgreementServiceTerm.isActive, true),
          gt(commercialAgreementServiceTerm.priceCents, 0),
        ),
      );

    const totalCents = terms.reduce(
      (sum, term) => sum + Math.max(0, term.priceCents),
      0,
    );
    if (terms.length === 0 || totalCents <= 0) {
      continue;
    }

    const firstDueDate = addDays(
      agreement.effectiveFrom,
      agreement.defaultPaymentTermDays,
    )
      .toISOString()
      .slice(0, 10);

    payloads.push({
      externalId: `contract:${agreement.id}`,
      organizationId,
      customerExternalId: `customer:${agreement.customerId}`,
      contractNumber: agreement.agreementCode,
      recurrence: "monthly",
      issueDate: agreement.effectiveFrom.toISOString(),
      startsAt: agreement.effectiveFrom.toISOString(),
      endsAt: agreement.effectiveTo?.toISOString() ?? null,
      sellerExternalId: null,
      totalCents,
      currency: agreement.currency,
      categoryId: null,
      costCenterId: null,
      notes: [agreement.title, agreement.notes].filter(Boolean).join("\n"),
      items: terms.map((term) => ({
        lineId: `contract:${agreement.id}:term:${term.id}`,
        catalogItemExternalId: `service:${term.serviceId}`,
        description: term.serviceName,
        quantity: 1,
        unitPriceCents: term.priceCents,
        totalCents: term.priceCents,
      })),
      paymentTerms: {
        paymentMethodId: null,
        financialAccountId: null,
        paymentConditionLabel: "Recorrente mensal",
        dueDate: firstDueDate,
        dueDay: Number(firstDueDate.slice(8, 10)),
        firstDueDate,
        installments: [],
      },
    });
  }

  return payloads;
}
