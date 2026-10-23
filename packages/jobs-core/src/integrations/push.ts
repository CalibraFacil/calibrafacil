import { Client } from "pg";
import type {
  GenericFinancialErpConnectionConfig,
  IntegrationSyncTarget,
} from "@calibra-facil/shared";
import { type SyncPayload, buildMappedTargetPayload } from "./helpers.js";

function getTargetPath(
  config: GenericFinancialErpConnectionConfig,
  target: IntegrationSyncTarget,
) {
  if (target === "customer") return config.customerPath;
  if (
    target === "catalog_item" ||
    target === "contract" ||
    target === "supplier" ||
    target === "transporter" ||
    target === "payable"
  ) {
    throw new Error("Este alvo é suportado apenas pelo provider Conta Azul");
  }
  if (target === "service_order") return config.serviceOrderPath;
  return config.billingDocumentPath;
}

async function getExistingRemoteId(
  client: Client,
  integrationId: string,
  target: IntegrationSyncTarget,
  localEntityId: string,
): Promise<string | null> {
  const result = await client.query(
    `
        SELECT remote_entity_id
        FROM integration_object_link
        WHERE integration_id = $1
          AND target = $2
          AND local_entity_id = $3
        LIMIT 1
        `,
    [integrationId, target, localEntityId],
  );

  return result.rows[0]?.remote_entity_id ?? null;
}

async function upsertLink(
  client: Client,
  params: {
    integrationId: string;
    organizationId: string;
    target: IntegrationSyncTarget;
    localEntityId: string;
    remoteEntityId: string | null;
  },
) {
  await client.query(
    `
        INSERT INTO integration_object_link
          (id, integration_id, organization_id, target, local_entity_id, remote_entity_id, remote_display_id, last_synced_at)
        VALUES ($1, $2, $3, $4, $5, $6, $6, NOW())
        ON CONFLICT (integration_id, target, local_entity_id)
        DO UPDATE
          SET remote_entity_id = EXCLUDED.remote_entity_id,
              remote_display_id = EXCLUDED.remote_display_id,
              last_synced_at = NOW(),
              updated_at = NOW()
        `,
    [
      crypto.randomUUID(),
      params.integrationId,
      params.organizationId,
      params.target,
      params.localEntityId,
      params.remoteEntityId,
    ],
  );
}

function buildHeaders(secret: string) {
  return {
    Authorization: `Bearer ${secret}`,
    "Content-Type": "application/json",
  };
}

async function callRemoteJson(url: string, init: RequestInit) {
  const response = await fetch(url, init);
  const contentType = response.headers.get("content-type") ?? "";
  const data = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : await response.text().catch(() => null);

  return {
    ok: response.ok,
    status: response.status,
    data,
  };
}

function extractRemoteId(data: unknown): string | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const record = Object.fromEntries(Object.entries(data));
  if (typeof record.remoteId === "string" && record.remoteId.trim()) {
    return record.remoteId;
  }
  if (typeof record.id === "string" && record.id.trim()) {
    return record.id;
  }
  if (typeof record.id === "number") {
    return String(record.id);
  }
  return null;
}

export async function pushRecord(
  client: Client,
  params: {
    integrationId: string;
    organizationId: string;
    target: IntegrationSyncTarget;
    config: GenericFinancialErpConnectionConfig;
    secret: string;
    payload: SyncPayload;
  },
) {
  const { mappedPayload, issues } = buildMappedTargetPayload(
    params.config,
    params.target,
    params.payload,
  );

  if (issues.length > 0) {
    throw new Error(
      `Payload inválido para ${params.target}: ${issues.join(" ")}`,
    );
  }

  const existingRemoteId = await getExistingRemoteId(
    client,
    params.integrationId,
    params.target,
    params.payload.externalId,
  );
  const targetPath = getTargetPath(params.config, params.target);
  const method = existingRemoteId ? "PUT" : "POST";
  const url = existingRemoteId
    ? `${params.config.baseUrl}${targetPath}/${encodeURIComponent(existingRemoteId)}`
    : `${params.config.baseUrl}${targetPath}`;

  const result = await callRemoteJson(url, {
    method,
    headers: buildHeaders(params.secret),
    body: JSON.stringify(mappedPayload),
  });

  if (!result.ok) {
    throw new Error(`Remoto respondeu ${result.status}`);
  }

  const remoteId = extractRemoteId(result.data) ?? existingRemoteId;

  await upsertLink(client, {
    integrationId: params.integrationId,
    organizationId: params.organizationId,
    target: params.target,
    localEntityId: params.payload.externalId,
    remoteEntityId: remoteId,
  });
}
