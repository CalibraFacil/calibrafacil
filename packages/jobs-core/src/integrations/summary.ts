import type {
  IntegrationDependencyWarning,
  IntegrationSyncTarget,
  IntegrationTargetCoverageSummary,
} from "@calibra-facil/shared";
import { DEFAULT_SYNC_LIMIT } from "./helpers.js";

export function buildDependencyWarnings(params: {
  target: IntegrationSyncTarget;
  validated: boolean;
  integrationStatus: "ACTIVE" | "DISABLED";
  coverageByTarget: Record<
    IntegrationSyncTarget,
    IntegrationTargetCoverageSummary
  >;
}): IntegrationDependencyWarning[] {
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
  }

  if (params.target === "billing_document") {
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

  return warnings;
}

export function buildRunSummary(params: {
  target: IntegrationSyncTarget;
  requestedLimit?: number;
  processedCount?: number;
  successCount?: number;
  errorCount?: number;
  blocked?: boolean;
  retryOfRunId?: string | null;
}) {
  return {
    target: params.target,
    requestedLimit: params.requestedLimit ?? DEFAULT_SYNC_LIMIT,
    processedCount: params.processedCount ?? 0,
    successCount: params.successCount ?? 0,
    errorCount: params.errorCount ?? 0,
    blocked: params.blocked ?? false,
    retryOfRunId: params.retryOfRunId ?? null,
  };
}
