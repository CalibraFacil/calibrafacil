import {
  normalizeContaAzulConnectionConfig,
  type IntegrationPayablePayload,
  type IntegrationBillingDocumentPayload,
  type IntegrationCatalogItemPayload,
  type IntegrationContractPayload,
  type IntegrationCustomerPayload,
  type IntegrationServiceOrderPayload,
  type IntegrationSyncTarget,
} from "@calibra-facil/shared";
import { type IntegrationSyncPayload } from "./types";

export function isContaAzulTargetEnabled(
  config: ReturnType<typeof normalizeContaAzulConnectionConfig>,
  target: IntegrationSyncTarget,
) {
  if (target === "catalog_item") {
    return config.enabledTargets.products || config.enabledTargets.services;
  }
  if (target === "contract") {
    return config.enabledTargets.contracts;
  }
  if (target === "customer") {
    return config.enabledTargets.customers;
  }
  if (target === "supplier") {
    return config.enabledTargets.suppliers;
  }
  if (target === "transporter") {
    return config.enabledTargets.transporters;
  }
  if (target === "billing_document") {
    return config.enabledTargets.billingDocuments;
  }
  if (target === "payable") {
    return config.enabledTargets.payables || config.enabledTargets.expenses;
  }
  return (
    config.enabledTargets.sales ||
    (config.exportMode === "budget_to_sale" && config.enabledTargets.budgets)
  );
}

export function isCatalogItemPayload(
  payload: IntegrationSyncPayload,
): payload is IntegrationCatalogItemPayload {
  return "kind" in payload && "code" in payload && "priceCents" in payload;
}

export function isContractPayload(
  payload: IntegrationSyncPayload,
): payload is IntegrationContractPayload {
  return "recurrence" in payload && "contractNumber" in payload;
}

export function isCustomerPayload(
  payload: IntegrationSyncPayload,
): payload is IntegrationCustomerPayload {
  return "taxId" in payload && "name" in payload && !("pessoaRole" in payload);
}

export function isServiceOrderPayload(
  payload: IntegrationSyncPayload,
): payload is IntegrationServiceOrderPayload {
  return "jobId" in payload && "assetName" in payload;
}

export function isPayablePayload(
  payload: IntegrationSyncPayload,
): payload is IntegrationPayablePayload {
  return "amountCents" in payload && "supplierExternalId" in payload;
}

export function isBillingDocumentPayload(
  payload: IntegrationSyncPayload,
): payload is IntegrationBillingDocumentPayload {
  return "documentNumber" in payload && "totalCents" in payload;
}
