import {
  normalizeContaAzulConnectionConfig,
  type IntegrationPayablePayload,
  type GenericFinancialErpConnectionConfig,
  type IntegrationBillingDocumentPayload,
  type IntegrationCatalogItemPayload,
  type IntegrationContractPayload,
  type IntegrationCustomerPayload,
  type IntegrationServiceOrderPayload,
  type IntegrationSupplierPayload,
  type IntegrationSyncTarget,
  type IntegrationTransporterPayload,
} from "@calibra-facil/shared";
import type { IntegrationsEnv } from "../../lib/integrations-env";
import {
  type GenericConnectionRecord,
  type IntegrationSyncPayload,
} from "./types";
import { createContaAzulAdapterForRecord } from "./conta-azul-auth";
import {
  isBillingDocumentPayload,
  isCatalogItemPayload,
  isContractPayload,
  isCustomerPayload,
  isPayablePayload,
  isServiceOrderPayload,
} from "./payload-guards";
import {
  buildMappedTargetPayload,
  mapServiceOrderToBudgetPayload,
  mapServiceOrderToSalePayload,
} from "./mapping";
import { getExistingLink, upsertLink } from "./sync-state";
import { loadCustomerPayloadByExternalId } from "./payloads-parties";
import { writeIntegrationEvent } from "./records";
import {
  buildAuthHeaders,
  callRemoteJson,
  extractRemoteId,
} from "./generic-remote";

export async function pushContaAzulTargetRecord(params: {
  record: GenericConnectionRecord;
  target: IntegrationSyncTarget;
  env: IntegrationsEnv;
  payload: IntegrationSyncPayload;
}) {
  const adapter = await createContaAzulAdapterForRecord({
    record: params.record,
    env: params.env,
  });
  const config = normalizeContaAzulConnectionConfig(
    params.record.connection.config,
  );

  if (params.target === "catalog_item") {
    if (!isCatalogItemPayload(params.payload)) {
      throw new Error("Payload de catálogo inválido para Conta Azul");
    }
    // Gate per kind: services and products (materials) are enabled
    // independently on the connection.
    if (params.payload.kind === "service" && !config.enabledTargets.services) {
      throw new Error("Sincronização de serviços Conta Azul desativada");
    }
    if (params.payload.kind === "product" && !config.enabledTargets.products) {
      throw new Error("Sincronização de produtos Conta Azul desativada");
    }
    if (!adapter.upsertCatalogItem) {
      throw new Error("Provider Conta Azul sem suporte a catálogo");
    }
    return adapter.upsertCatalogItem(params.payload);
  }

  if (params.target === "contract") {
    if (!isContractPayload(params.payload)) {
      throw new Error("Payload de contrato inválido para Conta Azul");
    }
    if (!config.enabledTargets.contracts) {
      throw new Error("Sincronização de contratos Conta Azul desativada");
    }
    if (!adapter.upsertContract) {
      throw new Error("Provider Conta Azul sem suporte a contratos");
    }
    return adapter.upsertContract(params.payload);
  }

  if (params.target === "customer") {
    if (!isCustomerPayload(params.payload)) {
      throw new Error("Payload de cliente inválido para Conta Azul");
    }
    if (!config.enabledTargets.customers) {
      throw new Error("Sincronização de clientes Conta Azul desativada");
    }
    return adapter.upsertCustomer(params.payload);
  }

  if (params.target === "supplier") {
    if (
      !("pessoaRole" in params.payload) ||
      params.payload.pessoaRole !== "supplier"
    ) {
      throw new Error("Payload de fornecedor inválido para Conta Azul");
    }
    if (!config.enabledTargets.suppliers) {
      throw new Error("Sincronização de fornecedores Conta Azul desativada");
    }
    if (!adapter.upsertSupplier) {
      throw new Error("Provider Conta Azul sem suporte a fornecedores");
    }
    return adapter.upsertSupplier(params.payload);
  }

  if (params.target === "transporter") {
    if (
      !("pessoaRole" in params.payload) ||
      params.payload.pessoaRole !== "transporter"
    ) {
      throw new Error("Payload de transportadora inválido para Conta Azul");
    }
    if (!config.enabledTargets.transporters) {
      throw new Error("Sincronização de transportadoras Conta Azul desativada");
    }
    if (!adapter.upsertTransporter) {
      throw new Error("Provider Conta Azul sem suporte a transportadoras");
    }
    return adapter.upsertTransporter(params.payload);
  }

  if (params.target === "service_order") {
    if (!isServiceOrderPayload(params.payload)) {
      throw new Error("Payload de ordem de serviço inválido para Conta Azul");
    }

    if (config.exportMode === "budget_to_sale") {
      if (!config.enabledTargets.budgets) {
        throw new Error("Sincronização de orçamentos Conta Azul desativada");
      }
      if (!adapter.exportBudget) {
        throw new Error("Provider Conta Azul sem suporte a orçamentos");
      }
      const budget = await adapter.exportBudget(
        mapServiceOrderToBudgetPayload(params.payload),
      );
      await upsertLink({
        integrationId: params.record.integration.id,
        organizationId: params.record.integration.organizationId,
        target: "service_order",
        localEntityId: params.payload.externalId,
        remoteEntityId: budget.remoteEntityId,
        remoteDisplayId: budget.remoteDisplayId ?? budget.remoteEntityId,
        remoteEntityType: budget.remoteEntityType ?? "conta_azul_budget_sale",
        metadata: {
          provider: "conta_azul",
          resource: "venda/busca",
          exportMode: config.exportMode,
          aliasForTarget: "budget",
          budgetRemoteId: budget.remoteEntityId,
        },
      });
      return budget;
    }

    if (!config.enabledTargets.sales) {
      throw new Error("Sincronização de vendas Conta Azul desativada");
    }
    if (!adapter.exportSale) {
      throw new Error("Provider Conta Azul sem suporte a vendas");
    }
    const sale = await adapter.exportSale(
      mapServiceOrderToSalePayload(params.payload),
    );
    await upsertLink({
      integrationId: params.record.integration.id,
      organizationId: params.record.integration.organizationId,
      target: "service_order",
      localEntityId: params.payload.externalId,
      remoteEntityId: sale.remoteEntityId,
      remoteDisplayId: sale.remoteDisplayId ?? sale.remoteEntityId,
      remoteEntityType: sale.remoteEntityType ?? "conta_azul_sale",
      metadata: {
        provider: "conta_azul",
        resource: "venda",
        exportMode: config.exportMode,
        aliasForTarget: "sale",
        saleRemoteId: sale.remoteEntityId,
      },
    });
    return sale;
  }

  if (params.target === "payable") {
    if (!isPayablePayload(params.payload)) {
      throw new Error("Payload de conta a pagar inválido para Conta Azul");
    }
    if (!config.enabledTargets.payables && !config.enabledTargets.expenses) {
      throw new Error("Sincronização de contas a pagar Conta Azul desativada");
    }
    if (!config.enabledTargets.suppliers) {
      // Preview blocking already prevents new payables from being scheduled
      // without a supplier sync, but scheduled runs created when the domain
      // was still enabled can race with a toggle-off. Stop the export here so
      // suppliers and payables stay in lockstep.
      throw new Error(
        "Habilite fornecedores da Conta Azul antes de exportar contas a pagar",
      );
    }
    if (!adapter.exportPayable) {
      throw new Error("Provider Conta Azul sem suporte a contas a pagar");
    }
    return adapter.exportPayable(params.payload);
  }

  if (!isBillingDocumentPayload(params.payload)) {
    throw new Error("Payload de faturamento inválido para Conta Azul");
  }
  if (!config.enabledTargets.billingDocuments) {
    throw new Error("Sincronização de faturamento Conta Azul desativada");
  }

  try {
    return await adapter.exportBillingDocument(params.payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (
      !message.includes("Cliente precisa ser sincronizado") ||
      !params.payload.customerExternalId
    ) {
      throw error;
    }

    // Respect the customers domain toggle: do not auto-create the customer in
    // Conta Azul when that domain is disabled, even on the billing recovery path.
    if (!config.enabledTargets.customers) {
      throw error;
    }

    const customerPayload = await loadCustomerPayloadByExternalId(
      params.record.integration.organizationId,
      params.payload.customerExternalId,
    );

    if (!customerPayload) {
      throw error;
    }

    await adapter.upsertCustomer(customerPayload);
    await writeIntegrationEvent({
      integrationId: params.record.integration.id,
      organizationId: params.record.integration.organizationId,
      level: "info",
      event: "integration.conta_azul.customer_auto_synced",
      message: "Cliente sincronizado automaticamente antes do faturamento",
      details: {
        customerExternalId: customerPayload.externalId,
        billingDocumentExternalId: params.payload.externalId,
      },
    });

    return adapter.exportBillingDocument(params.payload);
  }
}

function getTargetPath(
  config: GenericFinancialErpConnectionConfig,
  target: IntegrationSyncTarget,
) {
  switch (target) {
    case "customer":
      return config.customerPath;
    case "catalog_item":
    case "contract":
    case "supplier":
    case "transporter":
    case "payable":
      throw new Error("Este alvo é suportado apenas pelo provider Conta Azul");
    case "service_order":
      return config.serviceOrderPath;
    case "billing_document":
      return config.billingDocumentPath;
  }
}

export async function pushTargetRecord(params: {
  integrationId: string;
  organizationId: string;
  target: IntegrationSyncTarget;
  config: GenericFinancialErpConnectionConfig;
  secret: string;
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
  const { mappedPayload, issues } = buildMappedTargetPayload({
    config: params.config,
    target: params.target,
    payload: params.payload,
  });

  if (issues.length > 0) {
    throw new Error(
      `Payload inválido para ${params.target}: ${issues.join(" ")}`,
    );
  }

  const existing = await getExistingLink(
    params.organizationId,
    params.integrationId,
    params.target,
    params.payload.externalId,
  );
  const targetPath = getTargetPath(params.config, params.target);
  const remoteEntityId = existing?.remoteEntityId ?? null;
  const url = remoteEntityId
    ? `${params.config.baseUrl}${targetPath}/${encodeURIComponent(remoteEntityId)}`
    : `${params.config.baseUrl}${targetPath}`;
  const method = remoteEntityId ? "PUT" : "POST";

  const result = await callRemoteJson(url, {
    method,
    headers: buildAuthHeaders(params.secret),
    body: JSON.stringify(mappedPayload),
  });

  if (!result.ok) {
    throw new Error(
      `Falha ao sincronizar ${params.target}: remoto respondeu ${result.status}`,
    );
  }

  const resolvedRemoteId = extractRemoteId(result.data) ?? remoteEntityId;

  await upsertLink({
    integrationId: params.integrationId,
    organizationId: params.organizationId,
    target: params.target,
    localEntityId: params.payload.externalId,
    remoteEntityId: resolvedRemoteId,
  });

  return {
    remoteEntityId: resolvedRemoteId,
    remoteDisplayId: resolvedRemoteId,
    remoteEntityType: params.target,
  };
}
