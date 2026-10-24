import type { OrgDb } from "@calibra-facil/db/for-org";
import { inOrgTransaction } from "../../lib/org-transaction";
import {
  integrationEventLog,
  integrationSyncCursor,
  integrationSyncRun,
} from "@calibra-facil/db/schema";
import {
  normalizeContaAzulConnectionConfig,
  type IntegrationSyncCursor,
} from "@calibra-facil/shared";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  getRunPollKind,
  isContaAzulPollEnabled,
  isContaAzulScheduledPollKind,
  parseRemoteDate,
} from "./conta-azul-due";
import {
  type ContaAzulScheduleRow,
  type ContaAzulScheduleState,
  type ContaAzulScheduledPollKind,
} from "./types";
import { toRecord } from "./utils";
import { getIntegrationRecord } from "./records";
import { CONTA_AZUL_POLL_DEFINITIONS } from "./constants";

function addMilliseconds(value: string, intervalMs: number) {
  const parsed = parseRemoteDate(value);
  if (!parsed) return null;
  return new Date(parsed.getTime() + intervalMs).toISOString();
}

function isSuccessfulScheduleRun(
  run: typeof integrationSyncRun.$inferSelect,
  kind: ContaAzulScheduledPollKind,
) {
  return (
    run.trigger === "scheduled" &&
    getRunPollKind(run) === kind &&
    (run.status === "COMPLETED" || run.status === "PARTIAL")
  );
}

function isFailedScheduleRun(
  run: typeof integrationSyncRun.$inferSelect,
  kind: ContaAzulScheduledPollKind,
) {
  return (
    run.trigger === "scheduled" &&
    getRunPollKind(run) === kind &&
    run.status === "FAILED"
  );
}

function getEventPollKind(
  event: Pick<typeof integrationEventLog.$inferSelect, "details">,
) {
  const details =
    event.details && typeof event.details === "object"
      ? toRecord(event.details)
      : null;
  const pollKind = details?.pollKind;
  return isContaAzulScheduledPollKind(pollKind) ? pollKind : null;
}

function buildEmptyScheduleRow(): ContaAzulScheduleRow {
  return {
    enabled: false,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastErrorMessage: null,
    nextDueAt: null,
    intervalMinutes: 0,
  };
}

export async function getContaAzulScheduleState(
  params: {
    integrationId: string;
    organizationId: string;
    now?: Date;
  },
  executor?: OrgDb,
): Promise<ContaAzulScheduleState> {
  return inOrgTransaction(params.organizationId, executor, async (o) => {
    const record = await getIntegrationRecord(
      params.organizationId,
      params.integrationId,
      o,
    );

    if (!record || record.integration.provider !== "conta_azul") {
      throw new Error("Integração Conta Azul não encontrada");
    }

    const config = normalizeContaAzulConnectionConfig(record.connection.config);
    const runs = await o
      .select()
      .from(integrationSyncRun)
      .where(
        and(
          eq(integrationSyncRun.integrationId, params.integrationId),
          eq(integrationSyncRun.organizationId, params.organizationId),
          eq(integrationSyncRun.trigger, "scheduled"),
        ),
      )
      .orderBy(desc(integrationSyncRun.createdAt))
      .limit(100);
    const errorEvents = await o
      .select()
      .from(integrationEventLog)
      .where(
        and(
          eq(integrationEventLog.integrationId, params.integrationId),
          eq(integrationEventLog.organizationId, params.organizationId),
          eq(integrationEventLog.level, "error"),
          isNotNull(sql`${integrationEventLog.details}->>'pollKind'`),
          inArray(
            sql<string>`${integrationEventLog.details}->>'pollKind'`,
            CONTA_AZUL_POLL_DEFINITIONS.map((definition) => definition.kind),
          ),
        ),
      )
      .orderBy(desc(integrationEventLog.createdAt))
      .limit(500);

    const state: ContaAzulScheduleState = {
      paymentStatusPolling: buildEmptyScheduleRow(),
      payables: buildEmptyScheduleRow(),
      fiscalDocuments: buildEmptyScheduleRow(),
      protocols: buildEmptyScheduleRow(),
      driftChecks: buildEmptyScheduleRow(),
      productStock: buildEmptyScheduleRow(),
    };

    for (const definition of CONTA_AZUL_POLL_DEFINITIONS) {
      const enabled = isContaAzulPollEnabled(config, definition.kind);
      const lastSuccessRun = runs.find((run) =>
        isSuccessfulScheduleRun(run, definition.kind),
      );
      const lastFailedRun = runs.find((run) =>
        isFailedScheduleRun(run, definition.kind),
      );
      const lastErrorEvent = errorEvents.find(
        (event) => getEventPollKind(event) === definition.kind,
      );
      const lastSuccessAt =
        lastSuccessRun?.finishedAt?.toISOString?.() ??
        lastSuccessRun?.createdAt?.toISOString?.() ??
        null;
      const lastErrorAt =
        lastFailedRun?.finishedAt?.toISOString?.() ??
        lastFailedRun?.createdAt?.toISOString?.() ??
        lastErrorEvent?.createdAt?.toISOString?.() ??
        null;
      const hasRecentFailure =
        lastErrorAt !== null &&
        (lastSuccessAt === null || lastErrorAt > lastSuccessAt);
      const nextDueAt =
        enabled && lastSuccessAt && !hasRecentFailure
          ? addMilliseconds(lastSuccessAt, definition.intervalMs)
          : null;

      state[definition.kind] = {
        enabled,
        lastSuccessAt,
        lastErrorAt,
        lastErrorMessage:
          lastFailedRun?.errorSummary ?? lastErrorEvent?.message ?? null,
        nextDueAt,
        intervalMinutes: Math.round(definition.intervalMs / 60_000),
      };
    }

    return state;
  });
}

export function readCursorStateText(
  cursor: typeof integrationSyncCursor.$inferSelect | null | undefined,
  key: string,
) {
  const value = toRecord(cursor?.state)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function getIntegrationCursor(
  params: {
    integrationId: string;
    organizationId: string;
    cursorType: string;
  },
  executor?: OrgDb,
) {
  const [cursor] = await inOrgTransaction(
    params.organizationId,
    executor,
    (o) =>
      o
        .select()
        .from(integrationSyncCursor)
        .where(
          and(
            eq(integrationSyncCursor.integrationId, params.integrationId),
            eq(integrationSyncCursor.cursorType, params.cursorType),
          ),
        )
        .limit(1),
  );
  return cursor;
}

export async function upsertIntegrationCursor(
  params: {
    integrationId: string;
    organizationId: string;
    cursor: IntegrationSyncCursor;
  },
  executor?: OrgDb,
) {
  return inOrgTransaction(params.organizationId, executor, async (o) => {
    const existing = await getIntegrationCursor(
      {
        integrationId: params.integrationId,
        organizationId: params.organizationId,
        cursorType: params.cursor.cursorType,
      },
      o,
    );
    const values = {
      lastRemoteUpdatedAt: parseRemoteDate(params.cursor.lastRemoteUpdatedAt),
      lastSuccessfulPollAt: parseRemoteDate(params.cursor.lastSuccessfulPollAt),
      nextPage: params.cursor.nextPage,
      state: params.cursor.state,
      updatedAt: new Date(),
    };

    if (existing) {
      await o
        .update(integrationSyncCursor)
        .set(values)
        .where(eq(integrationSyncCursor.id, existing.id));
      return;
    }

    await o.insert(integrationSyncCursor).values({
      integrationId: params.integrationId,
      organizationId: params.organizationId,
      cursorType: params.cursor.cursorType,
      ...values,
    });
  });
}
