import { organizationIntegration } from "@calibra-facil/db/schema";
import {
  normalizeContaAzulConnectionConfig,
  type FinancialErpConnectionConfig,
  type IntegrationDependencyWarning,
  type IntegrationSyncTarget,
  type IntegrationTargetCoverageSummary,
} from "@calibra-facil/shared";
import { isContaAzulTargetEnabled } from "./payload-guards";
import {
  isContaAzulCommercialCatalogEnabled,
  isContaAzulCommercialExportEnabled,
} from "./payload-targets";

export function buildDependencyWarnings(params: {
  target: IntegrationSyncTarget;
  provider: (typeof organizationIntegration.$inferSelect)["provider"];
  config: FinancialErpConnectionConfig;
  integrationStatus: (typeof organizationIntegration.$inferSelect)["status"];
  validated: boolean;
  coverageByTarget: Record<
    IntegrationSyncTarget,
    IntegrationTargetCoverageSummary
  >;
}) {
  const warnings: IntegrationDependencyWarning[] = [];

  if (params.integrationStatus !== "ACTIVE") {
    warnings.push({
      code: "INTEGRATION_DISABLED",
      target: params.target,
      severity: "error",
      message: "Ative a integração antes de sincronizar este alvo.",
    });
  }

  if (!params.validated) {
    warnings.push({
      code: "VALIDATION_REQUIRED",
      target: params.target,
      severity: "error",
      message: "Valide a conexão antes de executar sincronizações.",
    });
  }

  if (
    params.provider === "conta_azul" &&
    (params.target === "catalog_item" ||
      params.target === "contract" ||
      params.target === "supplier" ||
      params.target === "transporter") &&
    !isContaAzulTargetEnabled(
      normalizeContaAzulConnectionConfig(params.config),
      params.target,
    )
  ) {
    warnings.push({
      code: "REMOTE_CONFIG_MISSING",
      target: params.target,
      severity: "error",
      message:
        params.target === "catalog_item"
          ? "Habilite catálogo de serviços ou produtos da Conta Azul antes de sincronizar catálogo."
          : params.target === "contract"
            ? "Habilite contratos da Conta Azul antes de sincronizar contratos recorrentes."
            : params.target === "supplier"
              ? "Habilite fornecedores da Conta Azul antes de sincronizar terceiros."
              : "Habilite transportadoras da Conta Azul antes de sincronizar transportadoras.",
    });
  }

  if (
    (params.target === "catalog_item" || params.target === "contract") &&
    params.provider === "generic_http"
  ) {
    warnings.push({
      code: "REMOTE_CONFIG_MISSING",
      target: params.target,
      severity: "error",
      message:
        "Este alvo é suportado pelo provider nativo Conta Azul; o conector HTTP genérico permanece separado.",
    });
  }

  if (params.target === "contract" && params.provider === "conta_azul") {
    const config = normalizeContaAzulConnectionConfig(params.config);
    const customerCoverage = params.coverageByTarget.customer;
    const catalogCoverage = params.coverageByTarget.catalog_item;

    if (customerCoverage.localCount > customerCoverage.linkedCount) {
      warnings.push({
        code: "CUSTOMERS_NOT_SYNCED",
        target: params.target,
        severity: "error",
        message:
          "Existem clientes locais sem vínculo remoto. Sincronize clientes antes dos contratos.",
      });
    }

    if (catalogCoverage.localCount > catalogCoverage.linkedCount) {
      warnings.push({
        code: "CATALOG_NOT_ENABLED",
        target: params.target,
        severity: "warning",
        message:
          "Existem itens de catálogo sem vínculo remoto. Sincronize ou vincule produtos/serviços antes dos contratos.",
      });
    }

    if (!config.defaultFinancialAccountId) {
      warnings.push({
        code: "REMOTE_CONFIG_MISSING",
        target: params.target,
        severity: "error",
        message:
          "Selecione uma conta financeira padrão da Conta Azul antes de exportar contratos.",
      });
    }
  }

  if (params.target === "service_order") {
    const customerCoverage = params.coverageByTarget.customer;

    if (customerCoverage.localCount > customerCoverage.linkedCount) {
      warnings.push({
        code: "CUSTOMERS_NOT_SYNCED",
        target: params.target,
        severity: "error",
        message:
          "Existem clientes locais sem vínculo remoto. Sincronize clientes antes das ordens de serviço.",
      });
    }

    if (params.provider === "conta_azul") {
      const config = normalizeContaAzulConnectionConfig(params.config);
      const serviceOrderSyncEnabled =
        isContaAzulCommercialExportEnabled(config);

      if (!serviceOrderSyncEnabled) {
        warnings.push({
          code: "REMOTE_CONFIG_MISSING",
          target: params.target,
          severity: "error",
          message:
            "Habilite vendas ou orçamentos na Conta Azul antes de sincronizar ordens de serviço.",
        });
      }

      if (
        serviceOrderSyncEnabled &&
        !isContaAzulCommercialCatalogEnabled(config)
      ) {
        warnings.push({
          code: "CATALOG_NOT_ENABLED",
          target: params.target,
          severity: "warning",
          message:
            "Habilite catálogo de serviços ou produtos para resolver os itens comerciais exigidos pelas vendas/orçamentos da Conta Azul.",
        });
      }
    }
  }

  if (
    params.target === "billing_document" &&
    params.provider === "generic_http"
  ) {
    const customerCoverage = params.coverageByTarget.customer;
    const serviceOrderCoverage = params.coverageByTarget.service_order;

    if (customerCoverage.localCount > customerCoverage.linkedCount) {
      warnings.push({
        code: "CUSTOMERS_NOT_SYNCED",
        target: params.target,
        severity: "error",
        message:
          "Existem clientes locais sem vínculo remoto. Sincronize clientes antes do faturamento.",
      });
    }

    if (serviceOrderCoverage.localCount > serviceOrderCoverage.linkedCount) {
      warnings.push({
        code: "SERVICE_ORDERS_NOT_SYNCED",
        target: params.target,
        severity: "error",
        message:
          "Existem ordens de serviço sem vínculo remoto. Sincronize ordens antes do faturamento.",
      });
    }
  }

  if (
    params.target === "billing_document" &&
    params.provider === "conta_azul"
  ) {
    const config = normalizeContaAzulConnectionConfig(params.config);
    const customerCoverage = params.coverageByTarget.customer;

    if (customerCoverage.localCount > customerCoverage.linkedCount) {
      warnings.push({
        code: "CUSTOMERS_NOT_SYNCED",
        target: params.target,
        severity: "error",
        message:
          "Existem clientes locais sem vínculo remoto. Sincronize clientes antes do faturamento.",
      });
    }

    if (!config.defaultFinancialAccountId) {
      warnings.push({
        code: "REMOTE_CONFIG_MISSING",
        target: params.target,
        severity: "error",
        message:
          "Selecione uma conta financeira padrão da Conta Azul antes de exportar recebíveis.",
      });
    }

    if (
      (config.exportMode === "sale" ||
        config.exportMode === "sale_and_receivable") &&
      !isContaAzulCommercialCatalogEnabled(config)
    ) {
      warnings.push({
        code: "CATALOG_NOT_ENABLED",
        target: params.target,
        severity: "warning",
        message:
          "Habilite catálogo de serviços ou produtos para resolver os itens comerciais exigidos pelas vendas da Conta Azul.",
      });
    }
  }

  if (params.target === "payable" && params.provider === "conta_azul") {
    const config = normalizeContaAzulConnectionConfig(params.config);
    const supplierCoverage = params.coverageByTarget.supplier;

    if (!config.enabledTargets.payables && !config.enabledTargets.expenses) {
      warnings.push({
        code: "REMOTE_CONFIG_MISSING",
        target: params.target,
        severity: "error",
        message:
          "Habilite contas a pagar ou despesas na Conta Azul antes de exportar obrigações de terceiros.",
      });
    }

    if (!config.enabledTargets.suppliers) {
      warnings.push({
        code: "REMOTE_CONFIG_MISSING",
        target: params.target,
        severity: "error",
        message:
          "Habilite fornecedores da Conta Azul antes de exportar contas a pagar.",
      });
    }

    if (supplierCoverage.localCount > supplierCoverage.linkedCount) {
      warnings.push({
        code: "SUPPLIERS_NOT_SYNCED",
        target: params.target,
        severity: "error",
        message:
          "Existem fornecedores locais sem vínculo remoto. Sincronize fornecedores antes das contas a pagar.",
      });
    }

    if (!config.defaultFinancialAccountId) {
      warnings.push({
        code: "REMOTE_CONFIG_MISSING",
        target: params.target,
        severity: "error",
        message:
          "Selecione uma conta financeira padrão da Conta Azul antes de exportar contas a pagar.",
      });
    }
  }

  return warnings;
}

export function dedupeDependencyWarnings(
  warnings: IntegrationDependencyWarning[],
): IntegrationDependencyWarning[] {
  const map = new Map<string, IntegrationDependencyWarning>();

  for (const warning of warnings) {
    const key = `${warning.target}:${warning.code}`;
    if (!map.has(key)) {
      map.set(key, warning);
    }
  }

  return Array.from(map.values());
}
