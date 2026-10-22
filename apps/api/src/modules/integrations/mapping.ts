import { formatLabDayKey } from "@calibra-facil/documents";
import {
  applyIntegrationMappings,
  type IntegrationMappingValidationIssue,
  type IntegrationPayablePayload,
  type FinancialErpConnectionConfig,
  validateIntegrationMappings,
  type IntegrationBillingDocumentPayload,
  type IntegrationBudgetPayload,
  type IntegrationCatalogItemPayload,
  type IntegrationContractPayload,
  type IntegrationCustomerPayload,
  type IntegrationSalePayload,
  type IntegrationServiceOrderPayload,
  type IntegrationSupplierPayload,
  type IntegrationSyncTarget,
  type IntegrationTransporterPayload,
} from "@calibra-facil/shared";
import { toRecord } from "./utils";

function getMappingValidationIssues(
  config: Pick<FinancialErpConnectionConfig, "mappings">,
  target?: IntegrationSyncTarget,
): IntegrationMappingValidationIssue[] {
  const issues = validateIntegrationMappings(config.mappings);
  if (!target) return issues;
  return issues.filter((issue) => issue.target === target);
}

export function assertValidMappings(
  config: Pick<FinancialErpConnectionConfig, "mappings">,
  target?: IntegrationSyncTarget,
) {
  const issues = getMappingValidationIssues(config, target);
  if (issues.length === 0) return;

  throw new Error(issues.map((issue) => issue.message).join(" "));
}

export function buildMappedTargetPayload(params: {
  config: Pick<FinancialErpConnectionConfig, "mappings">;
  target: IntegrationSyncTarget;
  payload:
    | IntegrationCatalogItemPayload
    | IntegrationContractPayload
    | IntegrationCustomerPayload
    | IntegrationSupplierPayload
    | IntegrationTransporterPayload
    | IntegrationPayablePayload
    | IntegrationServiceOrderPayload
    | IntegrationBillingDocumentPayload;
}) {
  return applyIntegrationMappings(
    params.target,
    toRecord(params.payload),
    params.config.mappings[params.target],
  );
}

function getServiceOrderCommercialDate(
  payload: IntegrationServiceOrderPayload,
) {
  // The sale is dated by the laboratory's calendar day. The instants are UTC,
  // so slicing them (or "now") would date a sale approved after 21:00 in
  // Sao Paulo the following day.
  for (const candidate of [
    payload.approvedAt,
    payload.performedAt,
    payload.updatedAt,
  ]) {
    if (!candidate) continue;
    const instant = new Date(candidate);
    if (!Number.isNaN(instant.getTime())) return formatLabDayKey(instant);
  }
  return formatLabDayKey(new Date());
}

function getServiceOrderTotalCents(payload: IntegrationServiceOrderPayload) {
  if (
    typeof payload.servicePriceCents !== "number" ||
    !Number.isFinite(payload.servicePriceCents) ||
    payload.servicePriceCents <= 0
  ) {
    throw new Error(
      "Ordem de serviço sem valor comercial para exportar à Conta Azul",
    );
  }

  return Math.trunc(payload.servicePriceCents);
}

function buildServiceOrderCommercialNotes(
  payload: IntegrationServiceOrderPayload,
) {
  return [
    `Origem CalibraFácil: ${payload.externalId}`,
    payload.jobId ? `OS/job: ${payload.jobId}` : null,
    payload.unitName ? `Unidade: ${payload.unitName}` : null,
    payload.assetName ? `Instrumento: ${payload.assetName}` : null,
    payload.assetTag ? `Tag: ${payload.assetTag}` : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");
}

export function mapServiceOrderToSalePayload(
  payload: IntegrationServiceOrderPayload,
): IntegrationSalePayload {
  const saleDate = getServiceOrderCommercialDate(payload);
  const totalCents = getServiceOrderTotalCents(payload);

  return {
    externalId: payload.externalId,
    organizationId: payload.organizationId,
    customerExternalId: payload.customerExternalId,
    saleNumber: payload.jobId,
    saleDate,
    status: payload.status,
    sellerExternalId: null,
    categoryId: null,
    costCenterId: null,
    totalCents,
    currency: payload.currency ?? "BRL",
    notes: buildServiceOrderCommercialNotes(payload),
    items: [
      {
        lineId: `${payload.externalId}:service`,
        catalogItemExternalId: payload.serviceExternalId ?? null,
        description: payload.serviceName ?? `Serviço ${payload.jobId}`,
        quantity: 1,
        unitPriceCents: totalCents,
        totalCents,
      },
    ],
    paymentTerms: {
      paymentMethodId: null,
      financialAccountId: null,
      paymentConditionLabel: "À vista",
      dueDate: saleDate,
      installments: [
        {
          dueDate: saleDate,
          amountCents: totalCents,
          description: payload.jobId ? `OS ${payload.jobId}` : null,
        },
      ],
    },
  };
}

export function mapServiceOrderToBudgetPayload(
  payload: IntegrationServiceOrderPayload,
): IntegrationBudgetPayload {
  const salePayload = mapServiceOrderToSalePayload(payload);

  return {
    externalId: payload.externalId,
    organizationId: salePayload.organizationId,
    customerExternalId: salePayload.customerExternalId,
    budgetNumber: payload.jobId,
    issueDate: salePayload.saleDate,
    expirationDate: null,
    status: salePayload.status,
    sellerExternalId: salePayload.sellerExternalId,
    categoryId: salePayload.categoryId,
    costCenterId: salePayload.costCenterId,
    totalCents: salePayload.totalCents,
    currency: salePayload.currency,
    notes: salePayload.notes,
    items: salePayload.items,
    paymentTerms: salePayload.paymentTerms,
  };
}
