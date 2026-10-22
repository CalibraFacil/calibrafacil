import { type IntegrationSyncTarget } from "@calibra-facil/shared";
import { type ContaAzulPollDefinition } from "./types";

export const INTEGRATION_TARGETS = [
  "customer",
  "service_order",
  "billing_document",
] as const satisfies readonly IntegrationSyncTarget[];

export const CONTA_AZUL_SCHEDULED_SYNC_TARGETS = [
  "catalog_item",
  "contract",
  "customer",
  "supplier",
  "transporter",
  "service_order",
  "billing_document",
  "payable",
] as const satisfies readonly IntegrationSyncTarget[];

export const DEFAULT_INTEGRATION_SYNC_LIMIT = 50;

export const DEFAULT_CONTA_AZUL_PAYMENT_POLLING_INTERVAL_MS = 30 * 60 * 1000;

export const DEFAULT_CONTA_AZUL_FISCAL_POLLING_INTERVAL_MS = 60 * 60 * 1000;

export const DEFAULT_CONTA_AZUL_PROTOCOL_POLLING_INTERVAL_MS = 15 * 60 * 1000;

export const DEFAULT_CONTA_AZUL_DRIFT_POLLING_INTERVAL_MS = 4 * 60 * 60 * 1000;

export const DEFAULT_CONTA_AZUL_PRODUCT_STOCK_POLLING_INTERVAL_MS =
  4 * 60 * 60 * 1000;

export const CONTA_AZUL_TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;

export const CONTA_AZUL_RECEIVABLES_CURSOR_TYPE = "conta_azul_receivables";

export const CONTA_AZUL_PAYABLES_CURSOR_TYPE = "conta_azul_payables";

export const CONTA_AZUL_FISCAL_DOCUMENTS_CURSOR_TYPE =
  "conta_azul_fiscal_documents";

export const CONTA_AZUL_PROTOCOLS_CURSOR_TYPE = "conta_azul_protocols";

export const CONTA_AZUL_DRIFT_CURSOR_TYPE = "conta_azul_remote_drift";

export const CONTA_AZUL_PRODUCT_STOCK_CURSOR_TYPE = "conta_azul_product_stock";

export const CONTA_AZUL_POLL_DEFINITIONS = [
  {
    kind: "paymentStatusPolling",
    cursorType: CONTA_AZUL_RECEIVABLES_CURSOR_TYPE,
    target: "billing_document",
    intervalMs: DEFAULT_CONTA_AZUL_PAYMENT_POLLING_INTERVAL_MS,
    disabledMessage: "Polling de pagamentos da Conta Azul está desativado",
    failedMessage: "Falha no polling de pagamentos da Conta Azul",
    completedEvent: "integration.conta_azul.payment_poll.completed",
  },
  {
    kind: "payables",
    cursorType: CONTA_AZUL_PAYABLES_CURSOR_TYPE,
    target: "payable",
    intervalMs: DEFAULT_CONTA_AZUL_PAYMENT_POLLING_INTERVAL_MS,
    disabledMessage: "Polling de contas a pagar da Conta Azul está desativado",
    failedMessage: "Falha no polling de contas a pagar da Conta Azul",
    completedEvent: "integration.conta_azul.payable_poll.completed",
  },
  {
    kind: "fiscalDocuments",
    cursorType: CONTA_AZUL_FISCAL_DOCUMENTS_CURSOR_TYPE,
    target: "billing_document",
    intervalMs: DEFAULT_CONTA_AZUL_FISCAL_POLLING_INTERVAL_MS,
    disabledMessage: "Sincronização fiscal da Conta Azul está desativada",
    failedMessage: "Falha no polling fiscal da Conta Azul",
    completedEvent: "integration.conta_azul.fiscal_poll.completed",
  },
  {
    kind: "protocols",
    cursorType: CONTA_AZUL_PROTOCOLS_CURSOR_TYPE,
    target: "service_order",
    intervalMs: DEFAULT_CONTA_AZUL_PROTOCOL_POLLING_INTERVAL_MS,
    disabledMessage: "Polling de protocolos da Conta Azul está desativado",
    failedMessage: "Falha no polling de protocolos da Conta Azul",
    completedEvent: "integration.conta_azul.protocol_poll.completed",
  },
  {
    kind: "driftChecks",
    cursorType: CONTA_AZUL_DRIFT_CURSOR_TYPE,
    target: "billing_document",
    intervalMs: DEFAULT_CONTA_AZUL_DRIFT_POLLING_INTERVAL_MS,
    disabledMessage: "Verificação de drift da Conta Azul está desativada",
    failedMessage: "Falha na verificação de drift da Conta Azul",
    completedEvent: "integration.conta_azul.drift_poll.completed",
  },
  {
    kind: "productStock",
    cursorType: CONTA_AZUL_PRODUCT_STOCK_CURSOR_TYPE,
    target: "catalog_item",
    intervalMs: DEFAULT_CONTA_AZUL_PRODUCT_STOCK_POLLING_INTERVAL_MS,
    disabledMessage: "Sincronização de produtos da Conta Azul está desativada",
    failedMessage: "Falha no polling de estoque de produtos da Conta Azul",
    completedEvent: "integration.conta_azul.product_stock_poll.completed",
  },
] as const satisfies readonly ContaAzulPollDefinition[];
