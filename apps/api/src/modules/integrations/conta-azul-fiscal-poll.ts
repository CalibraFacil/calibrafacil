import { db } from "@calibra-facil/db";
import { integrationConnection } from "@calibra-facil/db/schema";
import {
  normalizeContaAzulConnectionConfig,
  type IntegrationMdfeLinkPayload,
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
import {
  CONTA_AZUL_FISCAL_DOCUMENTS_CURSOR_TYPE,
  CONTA_AZUL_PROTOCOLS_CURSOR_TYPE,
} from "./constants";
import { createContaAzulAdapterForRecord } from "./conta-azul-auth";
import { toRecord } from "./utils";

export async function pollContaAzulFiscalDocuments(params: {
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
  if (!config.enabledTargets.fiscalDocuments) {
    throw new Error("Sincronização fiscal da Conta Azul está desativada");
  }

  const storedCursor = await getIntegrationCursor({
    integrationId: params.integrationId,
    cursorType: CONTA_AZUL_FISCAL_DOCUMENTS_CURSOR_TYPE,
  });
  const adapter = await createContaAzulAdapterForRecord({
    record,
    env: params.env,
  });
  if (!adapter.pollFiscalDocuments) {
    throw new Error("Provider Conta Azul sem suporte a polling fiscal");
  }

  const cursor: IntegrationSyncCursor = {
    cursorType: CONTA_AZUL_FISCAL_DOCUMENTS_CURSOR_TYPE,
    lastRemoteUpdatedAt:
      storedCursor?.lastRemoteUpdatedAt?.toISOString() ??
      config.polling.invoicesLastRemoteUpdatedAt,
    lastSuccessfulPollAt:
      storedCursor?.lastSuccessfulPollAt?.toISOString() ?? null,
    nextPage:
      typeof storedCursor?.nextPage === "number" && storedCursor.nextPage > 0
        ? storedCursor.nextPage
        : null,
    state: {
      ...toRecord(storedCursor?.state),
      requestedLimit: Math.max(1, Math.min(params.limit ?? 50, 100)),
    },
  };

  const result = await adapter.pollFiscalDocuments(cursor);
  const nextConfig = normalizeContaAzulConnectionConfig({
    ...config,
    polling: {
      ...config.polling,
      invoicesLastRemoteUpdatedAt:
        result.cursor.lastRemoteUpdatedAt ??
        config.polling.invoicesLastRemoteUpdatedAt,
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
    event: "integration.conta_azul.fiscal_poll.completed",
    message: "Polling fiscal da Conta Azul concluído",
    details: {
      processedCount: result.processedCount,
      updatedCount: result.updatedCount,
      warnings: result.warnings,
    },
  });

  return result;
}

export async function linkContaAzulFiscalDocumentsToMdfe(params: {
  integrationId: string;
  organizationId: string;
  env: IntegrationsEnv;
  payload: IntegrationMdfeLinkPayload;
}) {
  const record = await getIntegrationRecord(
    params.organizationId,
    params.integrationId,
  );

  if (!record || record.integration.provider !== "conta_azul") {
    throw new Error("Integração Conta Azul não encontrada");
  }

  const config = normalizeContaAzulConnectionConfig(record.connection.config);
  if (!config.enabledTargets.fiscalDocuments) {
    throw new Error("Sincronização fiscal da Conta Azul está desativada");
  }

  const adapter = await createContaAzulAdapterForRecord({
    record,
    env: params.env,
  });
  if (!adapter.linkFiscalDocumentsToMdfe) {
    throw new Error("Provider Conta Azul sem suporte a vínculo MDF-e");
  }

  const result = await adapter.linkFiscalDocumentsToMdfe({
    ...params.payload,
    organizationId: params.organizationId,
  });

  await writeIntegrationEvent({
    integrationId: params.integrationId,
    organizationId: params.organizationId,
    level: "info",
    event: "integration.conta_azul.mdfe_link.completed",
    message: "Vínculo MDF-e da Conta Azul concluído",
    details: {
      remoteEntityId: result.remoteEntityId,
      remoteEntityType: result.remoteEntityType,
      accessKeyCount: params.payload.fiscalDocumentAccessKeys.length,
      status: params.payload.status,
    },
  });

  return result;
}

export async function pollContaAzulProtocols(params: {
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
  if (!config.enabledTargets.protocols) {
    throw new Error("Polling de protocolos da Conta Azul está desativado");
  }

  const storedCursor = await getIntegrationCursor({
    integrationId: params.integrationId,
    cursorType: CONTA_AZUL_PROTOCOLS_CURSOR_TYPE,
  });
  const adapter = await createContaAzulAdapterForRecord({
    record,
    env: params.env,
  });
  if (!adapter.pollProtocols) {
    throw new Error("Provider Conta Azul sem suporte a polling de protocolos");
  }

  const cursor: IntegrationSyncCursor = {
    cursorType: CONTA_AZUL_PROTOCOLS_CURSOR_TYPE,
    lastRemoteUpdatedAt:
      storedCursor?.lastRemoteUpdatedAt?.toISOString() ??
      config.polling.protocolsLastRemoteUpdatedAt,
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

  const result = await adapter.pollProtocols(cursor);
  const nextConfig = normalizeContaAzulConnectionConfig({
    ...config,
    polling: {
      ...config.polling,
      protocolsLastRemoteUpdatedAt:
        result.cursor.lastRemoteUpdatedAt ??
        config.polling.protocolsLastRemoteUpdatedAt,
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
    event: "integration.conta_azul.protocol_poll.completed",
    message: "Polling de protocolos da Conta Azul concluído",
    details: {
      processedCount: result.processedCount,
      updatedCount: result.updatedCount,
      warnings: result.warnings,
    },
  });

  return result;
}
