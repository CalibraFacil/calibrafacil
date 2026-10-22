import { integrationSyncRun } from "@calibra-facil/db/schema";
import { normalizeContaAzulConnectionConfig } from "@calibra-facil/shared";
import {
  CONTA_AZUL_POLL_DEFINITIONS,
  DEFAULT_CONTA_AZUL_DRIFT_POLLING_INTERVAL_MS,
  DEFAULT_CONTA_AZUL_FISCAL_POLLING_INTERVAL_MS,
  DEFAULT_CONTA_AZUL_PAYMENT_POLLING_INTERVAL_MS,
  DEFAULT_CONTA_AZUL_PROTOCOL_POLLING_INTERVAL_MS,
} from "./constants";
import { type ContaAzulScheduledPollKind } from "./types";
import { toRecord } from "./utils";

export function formatContaAzulDateTime(value: Date) {
  return value.toISOString().replace(/\.\d{3}Z$/, "");
}

export function parseRemoteDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function isContaAzulPaymentPollingDue(params: {
  config: ReturnType<typeof normalizeContaAzulConnectionConfig>;
  now: Date;
  intervalMs?: number;
  lastSuccessfulPollAt?: string | null;
  lastRemoteUpdatedAt?: string | null;
  pendingNextPage?: number | null;
}) {
  if (!params.config.enabledTargets.paymentStatusPolling) {
    return false;
  }

  if (
    typeof params.pendingNextPage === "number" &&
    params.pendingNextPage > 0
  ) {
    return true;
  }

  const lastPoll = parseRemoteDate(
    params.lastSuccessfulPollAt ??
      params.lastRemoteUpdatedAt ??
      params.config.polling.receivablesLastRemoteUpdatedAt,
  );
  if (!lastPoll) {
    return true;
  }

  const intervalMs =
    params.intervalMs ?? DEFAULT_CONTA_AZUL_PAYMENT_POLLING_INTERVAL_MS;
  return params.now.getTime() - lastPoll.getTime() >= intervalMs;
}

export function isContaAzulPayablePollingDue(params: {
  config: ReturnType<typeof normalizeContaAzulConnectionConfig>;
  now: Date;
  intervalMs?: number;
  lastSuccessfulPollAt?: string | null;
  lastRemoteUpdatedAt?: string | null;
  pendingNextPage?: number | null;
}) {
  // Payable export already runs when either `payables` or `expenses` is on
  // (see isContaAzulPayableExportEnabled). Polling has to track the same set
  // so scheduled status reconciliation does not silently stall for
  // expenses-only configurations.
  const payablesOrExpensesEnabled =
    params.config.enabledTargets.payables ||
    params.config.enabledTargets.expenses;
  if (
    !params.config.enabledTargets.paymentStatusPolling ||
    !payablesOrExpensesEnabled
  ) {
    return false;
  }

  if (
    typeof params.pendingNextPage === "number" &&
    params.pendingNextPage > 0
  ) {
    return true;
  }

  const lastPoll = parseRemoteDate(
    params.lastSuccessfulPollAt ??
      params.lastRemoteUpdatedAt ??
      params.config.polling.payablesLastRemoteUpdatedAt,
  );
  if (!lastPoll) {
    return true;
  }

  const intervalMs =
    params.intervalMs ?? DEFAULT_CONTA_AZUL_PAYMENT_POLLING_INTERVAL_MS;
  return params.now.getTime() - lastPoll.getTime() >= intervalMs;
}

export function isContaAzulFiscalPollingDue(params: {
  config: ReturnType<typeof normalizeContaAzulConnectionConfig>;
  now: Date;
  intervalMs?: number;
  lastSuccessfulPollAt?: string | null;
  lastRemoteUpdatedAt?: string | null;
  pendingNextPage?: number | null;
}) {
  if (!params.config.enabledTargets.fiscalDocuments) {
    return false;
  }

  if (
    typeof params.pendingNextPage === "number" &&
    params.pendingNextPage > 0
  ) {
    return true;
  }

  const lastPoll = parseRemoteDate(
    params.lastSuccessfulPollAt ??
      params.lastRemoteUpdatedAt ??
      params.config.polling.invoicesLastRemoteUpdatedAt,
  );
  if (!lastPoll) {
    return true;
  }

  const intervalMs =
    params.intervalMs ?? DEFAULT_CONTA_AZUL_FISCAL_POLLING_INTERVAL_MS;
  return params.now.getTime() - lastPoll.getTime() >= intervalMs;
}

export function isContaAzulProtocolPollingDue(params: {
  config: ReturnType<typeof normalizeContaAzulConnectionConfig>;
  now: Date;
  intervalMs?: number;
  lastSuccessfulPollAt?: string | null;
  lastRemoteUpdatedAt?: string | null;
  pendingNextPage?: number | null;
}) {
  if (!params.config.enabledTargets.protocols) {
    return false;
  }

  if (
    typeof params.pendingNextPage === "number" &&
    params.pendingNextPage > 0
  ) {
    return true;
  }

  const lastPoll = parseRemoteDate(
    params.lastSuccessfulPollAt ??
      params.lastRemoteUpdatedAt ??
      params.config.polling.protocolsLastRemoteUpdatedAt,
  );
  if (!lastPoll) {
    return true;
  }

  const intervalMs =
    params.intervalMs ?? DEFAULT_CONTA_AZUL_PROTOCOL_POLLING_INTERVAL_MS;
  return params.now.getTime() - lastPoll.getTime() >= intervalMs;
}

export function isContaAzulDriftPollingDue(params: {
  config: ReturnType<typeof normalizeContaAzulConnectionConfig>;
  now: Date;
  intervalMs?: number;
  lastSuccessfulPollAt?: string | null;
  lastRemoteUpdatedAt?: string | null;
  pendingNextPage?: number | null;
}) {
  if (!params.config.enabledTargets.driftChecks) {
    return false;
  }

  if (
    typeof params.pendingNextPage === "number" &&
    params.pendingNextPage > 0
  ) {
    return true;
  }

  const lastPoll = parseRemoteDate(
    params.lastSuccessfulPollAt ??
      params.lastRemoteUpdatedAt ??
      params.config.polling.driftLastCheckedAt,
  );
  if (!lastPoll) {
    return true;
  }

  const intervalMs =
    params.intervalMs ?? DEFAULT_CONTA_AZUL_DRIFT_POLLING_INTERVAL_MS;
  return params.now.getTime() - lastPoll.getTime() >= intervalMs;
}

export function getContaAzulPollDefinition(kind: ContaAzulScheduledPollKind) {
  const definition = CONTA_AZUL_POLL_DEFINITIONS.find(
    (candidate) => candidate.kind === kind,
  );
  if (!definition) {
    throw new Error(`Poll Conta Azul inválido: ${kind}`);
  }
  return definition;
}

export function isContaAzulScheduledPollKind(
  value: unknown,
): value is ContaAzulScheduledPollKind {
  return (
    typeof value === "string" &&
    CONTA_AZUL_POLL_DEFINITIONS.some((definition) => definition.kind === value)
  );
}

export function isContaAzulPollEnabled(
  config: ReturnType<typeof normalizeContaAzulConnectionConfig>,
  kind: ContaAzulScheduledPollKind,
) {
  if (kind === "paymentStatusPolling") {
    return config.enabledTargets.paymentStatusPolling;
  }
  if (kind === "payables") {
    return config.enabledTargets.payables;
  }
  if (kind === "fiscalDocuments") {
    return config.enabledTargets.fiscalDocuments;
  }
  if (kind === "protocols") {
    return config.enabledTargets.protocols;
  }
  if (kind === "productStock") {
    // The stock mirror rides on the products catalog sync opt-in.
    return config.enabledTargets.products;
  }
  return config.enabledTargets.driftChecks;
}

export function isContaAzulPollDue(params: {
  config: ReturnType<typeof normalizeContaAzulConnectionConfig>;
  kind: ContaAzulScheduledPollKind;
  now: Date;
  intervalMs?: number;
  lastSuccessfulPollAt?: string | null;
  lastRemoteUpdatedAt?: string | null;
  pendingNextPage?: number | null;
}) {
  const base = {
    config: params.config,
    now: params.now,
    intervalMs: params.intervalMs,
    lastSuccessfulPollAt: params.lastSuccessfulPollAt,
    lastRemoteUpdatedAt: params.lastRemoteUpdatedAt,
    pendingNextPage: params.pendingNextPage,
  };

  if (params.kind === "paymentStatusPolling") {
    return isContaAzulPaymentPollingDue(base);
  }
  if (params.kind === "payables") {
    return isContaAzulPayablePollingDue(base);
  }
  if (params.kind === "fiscalDocuments") {
    return isContaAzulFiscalPollingDue(base);
  }
  if (params.kind === "protocols") {
    return isContaAzulProtocolPollingDue(base);
  }
  return isContaAzulDriftPollingDue(base);
}

export function getRunPollKind(
  run: Pick<typeof integrationSyncRun.$inferSelect, "summary">,
): ContaAzulScheduledPollKind | null {
  const summary =
    run.summary && typeof run.summary === "object"
      ? toRecord(run.summary)
      : null;
  const pollKind = summary?.pollKind;
  return isContaAzulScheduledPollKind(pollKind) ? pollKind : null;
}
