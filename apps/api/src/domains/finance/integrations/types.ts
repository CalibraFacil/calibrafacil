import {
  integrationConnection,
  organizationIntegration,
} from "@calibra-facil/db/schema";
import {
  type IntegrationPayablePayload,
  type IntegrationRemoteDocumentSummary,
  type FinancialErpConnectionConfig,
  type IntegrationBillingDocumentPayload,
  type IntegrationCatalogItemPayload,
  type IntegrationContractPayload,
  type IntegrationCustomerPayload,
  type IntegrationReadinessSummary,
  type IntegrationServiceOrderPayload,
  type IntegrationSupplierPayload,
  type IntegrationSyncStatus,
  type IntegrationSyncTarget,
  type IntegrationTargetSyncSummary,
  type IntegrationTransporterPayload,
} from "@calibra-facil/shared";

export interface IntegrationRunExecutionResult {
  status: IntegrationSyncStatus;
  processedCount: number;
  successCount: number;
  errorCount: number;
  errorSummary: string | null;
}

export type GenericConnectionRecord = {
  integration: typeof organizationIntegration.$inferSelect;
  connection: Omit<typeof integrationConnection.$inferSelect, "config"> & {
    config: FinancialErpConnectionConfig;
  };
};

export type IntegrationSyncPayload =
  | IntegrationCatalogItemPayload
  | IntegrationContractPayload
  | IntegrationCustomerPayload
  | IntegrationSupplierPayload
  | IntegrationTransporterPayload
  | IntegrationPayablePayload
  | IntegrationServiceOrderPayload
  | IntegrationBillingDocumentPayload;

export interface IntegrationOverview {
  readiness: IntegrationReadinessSummary;
  targets: IntegrationTargetSyncSummary[];
  remoteDocuments: IntegrationRemoteDocumentSummary;
  syncSummary: {
    lastRunAt: string | null;
    lastSuccessfulRunAt: string | null;
    lastErrorAt: string | null;
    hasRecentFailures: boolean;
  };
}

export type ContaAzulScheduledPollKind =
  | "paymentStatusPolling"
  | "payables"
  | "fiscalDocuments"
  | "protocols"
  | "driftChecks"
  | "productStock";

export type ContaAzulPollDefinition = {
  kind: ContaAzulScheduledPollKind;
  cursorType: string;
  target: IntegrationSyncTarget;
  intervalMs: number;
  disabledMessage: string;
  failedMessage: string;
  completedEvent: string;
};

export type ContaAzulScheduleRow = {
  enabled: boolean;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  nextDueAt: string | null;
  intervalMinutes: number;
};

export type ContaAzulScheduleState = Record<
  ContaAzulScheduledPollKind,
  ContaAzulScheduleRow
>;
