import { db } from "@calibra-facil/db";
import {
  integrationEventLog,
  integrationSyncRun,
  organizationEventLog,
  organizationIntegration,
} from "@calibra-facil/db/schema";
import {
  normalizeFinancialErpConnectionConfig,
  type IntegrationSyncTarget,
} from "@calibra-facil/shared";
import { and, desc, eq } from "drizzle-orm";
import { type GenericConnectionRecord } from "./types";

export async function listOrganizationIntegrations(organizationId: string) {
  return db.query.organizationIntegration.findMany({
    where: eq(organizationIntegration.organizationId, organizationId),
    with: {
      connection: true,
    },
    orderBy: [desc(organizationIntegration.createdAt)],
  });
}

export async function getIntegrationRecord(
  organizationId: string,
  integrationId: string,
): Promise<GenericConnectionRecord | null> {
  const integration = await db.query.organizationIntegration.findFirst({
    where: and(
      eq(organizationIntegration.id, integrationId),
      eq(organizationIntegration.organizationId, organizationId),
    ),
    with: {
      connection: true,
    },
  });

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

export async function writeIntegrationEvent(params: {
  integrationId: string;
  organizationId: string;
  runId?: string | null;
  level: "info" | "warning" | "error";
  event: string;
  message: string;
  details?: Record<string, unknown> | null;
}) {
  await db.insert(integrationEventLog).values({
    integrationId: params.integrationId,
    organizationId: params.organizationId,
    runId: params.runId ?? null,
    level: params.level,
    event: params.event,
    message: params.message,
    details: params.details ?? null,
  });
}

export async function markContaAzulReconnectRequired(params: {
  integrationId: string;
  organizationId: string;
  message: string;
  details?: Record<string, unknown> | null;
}) {
  await db
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

  await writeIntegrationEvent({
    integrationId: params.integrationId,
    organizationId: params.organizationId,
    level: "error",
    event: "integration.conta_azul.reconnect_required",
    message: params.message,
    details: {
      provider: "conta_azul",
      ...params.details,
    },
  });
}

export async function writeOrganizationIntegrationEvent(params: {
  organizationId: string;
  actorUserId: string;
  actorMemberId?: string | null;
  action: string;
  entityId: string;
  details?: Record<string, unknown> | null;
}) {
  await db.insert(organizationEventLog).values({
    organizationId: params.organizationId,
    actorUserId: params.actorUserId,
    actorMemberId: params.actorMemberId ?? null,
    action: params.action,
    entityType: "integration",
    entityId: params.entityId,
    details: params.details ?? null,
  });
}

export async function failIntegrationSyncRun(params: {
  integrationId: string;
  organizationId: string;
  runId: string;
  target: IntegrationSyncTarget;
  message: string;
  details?: Record<string, unknown> | null;
}) {
  await db
    .update(integrationSyncRun)
    .set({
      status: "FAILED",
      errorSummary: params.message,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(integrationSyncRun.id, params.runId));

  await writeIntegrationEvent({
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
  });
}
