import { integrationSyncRun } from "@calibra-facil/db/schema";
import { type IntegrationSyncTarget } from "@calibra-facil/shared";
import { type ContaAzulScheduledPollKind } from "./types";
import { DEFAULT_INTEGRATION_SYNC_LIMIT } from "./constants";
import { toRecord } from "./utils";

export function buildRunSummary(params: {
  target: IntegrationSyncTarget;
  processedCount?: number;
  successCount?: number;
  errorCount?: number;
  requestedLimit?: number;
  blocked?: boolean;
  retryOfRunId?: string | null;
  pollKind?: ContaAzulScheduledPollKind;
  cursorType?: string;
  updatedCount?: number;
  warnings?: unknown[];
}) {
  return {
    target: params.target,
    processedCount: params.processedCount ?? 0,
    successCount: params.successCount ?? 0,
    errorCount: params.errorCount ?? 0,
    requestedLimit: params.requestedLimit ?? DEFAULT_INTEGRATION_SYNC_LIMIT,
    blocked: params.blocked ?? false,
    retryOfRunId: params.retryOfRunId ?? null,
    ...(params.pollKind
      ? {
          pollKind: params.pollKind,
          cursorType: params.cursorType ?? null,
          updatedCount: params.updatedCount ?? 0,
          warnings: params.warnings ?? [],
        }
      : {}),
  } satisfies Record<string, unknown>;
}

export function getRequestedLimitFromRun(
  run: typeof integrationSyncRun.$inferSelect,
) {
  const summary =
    run.summary && typeof run.summary === "object"
      ? toRecord(run.summary)
      : null;
  const requestedLimit = summary?.requestedLimit;

  if (typeof requestedLimit === "number" && Number.isFinite(requestedLimit)) {
    return Math.max(1, Math.min(250, Math.trunc(requestedLimit)));
  }

  return DEFAULT_INTEGRATION_SYNC_LIMIT;
}
