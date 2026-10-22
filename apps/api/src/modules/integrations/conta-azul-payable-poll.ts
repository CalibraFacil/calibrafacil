import { db } from "@calibra-facil/db";
import { integrationConnection } from "@calibra-facil/db/schema";
import {
  normalizeContaAzulConnectionConfig,
  type IntegrationSyncCursor,
  type RemoteStatusPollResult,
} from "@calibra-facil/shared";
import { eq } from "drizzle-orm";
import type { IntegrationsEnv } from "../../lib/integrations-env";
import { getIntegrationRecord, writeIntegrationEvent } from "./records";
import {
  getIntegrationCursor,
  upsertIntegrationCursor,
} from "./conta-azul-schedule-state";
import { CONTA_AZUL_PAYABLES_CURSOR_TYPE } from "./constants";
import { createContaAzulAdapterForRecord } from "./conta-azul-auth";
import { toRecord } from "./utils";

export async function pollContaAzulPayableStatus(params: {
  integrationId: string;
  organizationId: string;
  env: IntegrationsEnv;
  limit?: number;
}): Promise<RemoteStatusPollResult> {
  const record = await getIntegrationRecord(
    params.organizationId,
    params.integrationId,
  );

  if (!record || record.integration.provider !== "conta_azul") {
    throw new Error("Integração Conta Azul não encontrada");
  }

  const config = normalizeContaAzulConnectionConfig(record.connection.config);
  if (!config.enabledTargets.payables) {
    throw new Error("Polling de contas a pagar da Conta Azul está desativado");
  }

  const storedCursor = await getIntegrationCursor({
    integrationId: params.integrationId,
    cursorType: CONTA_AZUL_PAYABLES_CURSOR_TYPE,
  });
  const adapter = await createContaAzulAdapterForRecord({
    record,
    env: params.env,
  });
  if (!adapter.pollPayableStatus) {
    throw new Error(
      "Provider Conta Azul sem suporte a polling de contas a pagar",
    );
  }

  const cursor: IntegrationSyncCursor = {
    cursorType: CONTA_AZUL_PAYABLES_CURSOR_TYPE,
    lastRemoteUpdatedAt:
      storedCursor?.lastRemoteUpdatedAt?.toISOString() ??
      config.polling.payablesLastRemoteUpdatedAt,
    lastSuccessfulPollAt:
      storedCursor?.lastSuccessfulPollAt?.toISOString() ?? null,
    nextPage:
      typeof storedCursor?.nextPage === "number" && storedCursor.nextPage > 0
        ? storedCursor.nextPage
        : null,
    state: {
      ...toRecord(storedCursor?.state),
      requestedLimit: Math.max(1, Math.min(params.limit ?? 50, 200)),
    },
  };

  const result = await adapter.pollPayableStatus(cursor);
  const nextConfig = normalizeContaAzulConnectionConfig({
    ...config,
    polling: {
      ...config.polling,
      payablesLastRemoteUpdatedAt:
        result.cursor.lastRemoteUpdatedAt ??
        config.polling.payablesLastRemoteUpdatedAt,
    },
  });

  await db
    .update(integrationConnection)
    .set({
      config: nextConfig,
      updatedAt: new Date(),
    })
    .where(eq(integrationConnection.id, record.connection.id));

  await upsertIntegrationCursor({
    integrationId: params.integrationId,
    organizationId: params.organizationId,
    cursor: result.cursor,
  });

  await writeIntegrationEvent({
    integrationId: params.integrationId,
    organizationId: params.organizationId,
    level: result.warnings.length > 0 ? "warning" : "info",
    event: "integration.conta_azul.payable_poll.completed",
    message: "Polling de contas a pagar da Conta Azul concluído",
    details: {
      processedCount: result.processedCount,
      updatedCount: result.updatedCount,
      warnings: result.warnings,
    },
  });

  return result;
}
