import type { OrgDb } from "@calibra-facil/db/for-org";
import {
  integrationConnection,
  integrationEventLog,
  integrationSyncRun,
  organizationEventLog,
  organizationIntegration,
} from "@calibra-facil/db/schema";
import {
  normalizeFinancialErpConnectionConfig,
  type IntegrationSyncTarget,
} from "@calibra-facil/shared";
import { and, desc, eq, type SQL } from "drizzle-orm";
import { inOrgTransaction } from "../../lib/org-transaction";
import { type GenericConnectionRecord } from "./types";

// Every function here runs in the caller's org-bound transaction (`executor`)
// or in one of its own that names the laboratory (row-level security).

/** Integrations with their (at most one) connection row, newest first. */
async function selectIntegrationsWithConnection(
  o: OrgDb,
  where: SQL | undefined,
  limit?: number,
) {
  const query = o
    .select({
      integration: organizationIntegration,
      connection: integrationConnection,
    })
    .from(organizationIntegration)
    .leftJoin(
      integrationConnection,
      eq(integrationConnection.integrationId, organizationIntegration.id),
    )
    .where(where)
    .orderBy(desc(organizationIntegration.createdAt));
  const rows = await (limit === undefined ? query : query.limit(limit));
  return rows.map((row) => ({
    ...row.integration,
    connection: row.connection,
  }));
}

export async function listOrganizationIntegrations(
  organizationId: string,
  executor?: OrgDb,
) {
  return inOrgTransaction(organizationId, executor, (o) =>
    selectIntegrationsWithConnection(
      o,
      eq(organizationIntegration.organizationId, organizationId),
    ),
  );
}

export async function getIntegrationRecord(
  organizationId: string,
  integrationId: string,
  executor?: OrgDb,
): Promise<GenericConnectionRecord | null> {
  const [integration] = await inOrgTransaction(organizationId, executor, (o) =>
    selectIntegrationsWithConnection(
      o,
      and(
        eq(organizationIntegration.id, integrationId),
        eq(organizationIntegration.organizationId, organizationId),
      ),
      1,
    ),
  );

  if (!integration?.connection) {
    return null;
  }

  return {
    integration,
    connection: {
      ...integration.connection,
      config: normalizeFinancialErpConnectionConfig(
        integration.provider,
        integration.connection.config,
      ),
    },
  };
}

export async function writeIntegrationEvent(
  params: {
    integrationId: string;
    organizationId: string;
    runId?: string | null;
    level: "info" | "warning" | "error";
    event: string;
    message: string;
    details?: Record<string, unknown> | null;
  },
  executor?: OrgDb,
) {
  await inOrgTransaction(params.organizationId, executor, async (o) => {
    await o.insert(integrationEventLog).values({
      integrationId: params.integrationId,
      organizationId: params.organizationId,
      runId: params.runId ?? null,
      level: params.level,
      event: params.event,
      message: params.message,
      details: params.details ?? null,
    });
  });
}

export async function markContaAzulReconnectRequired(
  params: {
    integrationId: string;
    organizationId: string;
    message: string;
    details?: Record<string, unknown> | null;
  },
  executor?: OrgDb,
) {
  await inOrgTransaction(params.organizationId, executor, async (o) => {
    await o
      .update(organizationIntegration)
      .set({
        status: "ACTION_REQUIRED",
        lastValidationError: params.message,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(organizationIntegration.id, params.integrationId),
          eq(organizationIntegration.organizationId, params.organizationId),
        ),
      );

    await writeIntegrationEvent(
      {
        integrationId: params.integrationId,
        organizationId: params.organizationId,
        level: "error",
        event: "integration.conta_azul.reconnect_required",
        message: params.message,
        details: {
          provider: "conta_azul",
          ...params.details,
        },
      },
      o,
    );
  });
}

export async function writeOrganizationIntegrationEvent(
  params: {
    organizationId: string;
    actorUserId: string;
    actorMemberId?: string | null;
    action: string;
    entityId: string;
    details?: Record<string, unknown> | null;
  },
  executor?: OrgDb,
) {
  await inOrgTransaction(params.organizationId, executor, async (o) => {
    await o.insert(organizationEventLog).values({
      organizationId: params.organizationId,
      actorUserId: params.actorUserId,
      actorMemberId: params.actorMemberId ?? null,
      action: params.action,
      entityType: "integration",
      entityId: params.entityId,
      details: params.details ?? null,
    });
  });
}

export async function failIntegrationSyncRun(
  params: {
    integrationId: string;
    organizationId: string;
    runId: string;
    target: IntegrationSyncTarget;
    message: string;
    details?: Record<string, unknown> | null;
  },
  executor?: OrgDb,
) {
  await inOrgTransaction(params.organizationId, executor, async (o) => {
    await o
      .update(integrationSyncRun)
      .set({
        status: "FAILED",
        errorSummary: params.message,
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(integrationSyncRun.id, params.runId));

    await writeIntegrationEvent(
      {
        integrationId: params.integrationId,
        organizationId: params.organizationId,
        runId: params.runId,
        level: "error",
        event: "sync.failed",
        message: params.message,
        details: {
          target: params.target,
          ...params.details,
        },
      },
      o,
    );
  });
}
