import {
  integrationObjectLink,
  material,
  organizationIntegration,
} from "@calibra-facil/db/schema";
import {
  normalizeContaAzulConnectionConfig,
  type RemoteStatusPollResult,
} from "@calibra-facil/shared";
import { and, desc, eq, sql } from "drizzle-orm";
import type { IntegrationsEnv } from "../../lib/integrations-env";
import { inOrgTransaction } from "../../lib/org-transaction";
import { getIntegrationRecord, writeIntegrationEvent } from "./records";
import { createContaAzulAdapterForRecord } from "./conta-azul-auth";
import { CONTA_AZUL_PRODUCT_STOCK_CURSOR_TYPE } from "./constants";
import { upsertIntegrationCursor } from "./conta-azul-schedule-state";

/**
 * Manual entrada/ajuste for a catalog material bound to a Conta Azul
 * product: sets the ERP product's absolute on-hand quantity (the ERP
 * records the movement as the difference) and refreshes the local
 * snapshot. Stock truth stays in the ERP — this is the one deliberate
 * write path besides the sale-driven decrement.
 */
export async function adjustMaterialErpStock(params: {
  organizationId: string;
  materialId: number;
  quantity: number;
  env: IntegrationsEnv;
}): Promise<{ stockQuantity: number; stockSyncedAt: Date }> {
  if (!Number.isFinite(params.quantity) || params.quantity < 0) {
    throw new Error("Quantidade de estoque inválida");
  }

  // The lookups share one transaction; the remote call below runs outside it.
  const { integrationRow, record, link } = await inOrgTransaction(
    params.organizationId,
    undefined,
    async (o) => {
      const [integrationRow] = await o
        .select({ integrationId: organizationIntegration.id })
        .from(organizationIntegration)
        .where(
          and(
            eq(organizationIntegration.organizationId, params.organizationId),
            eq(organizationIntegration.type, "financial_erp"),
            eq(organizationIntegration.provider, "conta_azul"),
            eq(organizationIntegration.status, "ACTIVE"),
          ),
        )
        .orderBy(desc(organizationIntegration.updatedAt))
        .limit(1);
      if (!integrationRow) {
        throw new Error("Nenhuma integração Conta Azul ativa encontrada");
      }

      const record = await getIntegrationRecord(
        params.organizationId,
        integrationRow.integrationId,
        o,
      );
      if (!record) {
        throw new Error("Integração Conta Azul não encontrada");
      }

      const config = normalizeContaAzulConnectionConfig(
        record.connection.config,
      );
      if (!config.enabledTargets.products) {
        throw new Error(
          "Sincronização de produtos da Conta Azul está desativada",
        );
      }

      const [link] = await o
        .select({ remoteEntityId: integrationObjectLink.remoteEntityId })
        .from(integrationObjectLink)
        .where(
          and(
            eq(
              integrationObjectLink.integrationId,
              integrationRow.integrationId,
            ),
            eq(integrationObjectLink.target, "catalog_item"),
            eq(
              integrationObjectLink.localEntityId,
              `material:${params.materialId}`,
            ),
          ),
        )
        .limit(1);
      return { integrationRow, record, link };
    },
  );
  if (!link?.remoteEntityId) {
    throw new Error(
      "Material não está vinculado a um produto na Conta Azul — sincronize o catálogo antes de ajustar o estoque",
    );
  }
  const remoteEntityId = link.remoteEntityId;

  const adapter = await createContaAzulAdapterForRecord({
    record,
    env: params.env,
  });
  if (!adapter.setProductStock) {
    throw new Error("Provider Conta Azul sem suporte a ajuste de estoque");
  }

  await adapter.setProductStock(remoteEntityId, params.quantity);

  const stockSyncedAt = new Date();
  await inOrgTransaction(params.organizationId, undefined, async (o) => {
    await o
      .update(material)
      .set({ stockQuantity: params.quantity, stockSyncedAt })
      .where(
        and(
          eq(material.id, params.materialId),
          eq(material.organizationId, params.organizationId),
        ),
      );

    await writeIntegrationEvent(
      {
        integrationId: integrationRow.integrationId,
        organizationId: params.organizationId,
        level: "info",
        event: "integration.conta_azul.product_stock_adjusted",
        message: "Ajuste de estoque enviado à Conta Azul",
        details: {
          materialId: params.materialId,
          quantity: params.quantity,
          remoteEntityId,
        },
      },
      o,
    );
  });

  return { stockQuantity: params.quantity, stockSyncedAt };
}

/**
 * Refresh the local on-hand snapshot (material.stock_quantity) from the ERP
 * for materials bound to Conta Azul products. Stock truth stays remote —
 * saída happens via the exported sale, entrada/ajuste via the explicit
 * stock-adjust action; this poll only mirrors balances for picker badges
 * and the materials list. Stalest snapshots refresh first so every linked
 * material converges even when there are more links than the per-run limit.
 */
export async function pollContaAzulProductStock(params: {
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
  if (!config.enabledTargets.products) {
    throw new Error("Sincronização de produtos da Conta Azul está desativada");
  }

  const adapter = await createContaAzulAdapterForRecord({
    record,
    env: params.env,
  });
  if (!adapter.fetchProductStock) {
    throw new Error("Provider Conta Azul sem suporte a estoque de produtos");
  }

  const limit = Math.max(1, Math.min(params.limit ?? 50, 200));
  const rows = await inOrgTransaction(params.organizationId, undefined, (o) =>
    o
      .select({
        materialId: material.id,
        remoteEntityId: integrationObjectLink.remoteEntityId,
      })
      .from(integrationObjectLink)
      .innerJoin(
        material,
        sql`${integrationObjectLink.localEntityId} = 'material:' || ${material.id}`,
      )
      .where(
        and(
          eq(integrationObjectLink.integrationId, params.integrationId),
          eq(integrationObjectLink.target, "catalog_item"),
          eq(material.organizationId, params.organizationId),
          eq(material.isActive, true),
        ),
      )
      .orderBy(sql`${material.stockSyncedAt} asc nulls first`)
      .limit(limit),
  );

  const warnings: string[] = [];
  let updatedCount = 0;

  for (const row of rows) {
    if (!row.remoteEntityId) {
      warnings.push(`material:${row.materialId}: vínculo sem id remoto`);
      continue;
    }
    try {
      const { quantity } = await adapter.fetchProductStock(row.remoteEntityId);
      await inOrgTransaction(params.organizationId, undefined, async (o) => {
        await o
          .update(material)
          .set({ stockQuantity: quantity, stockSyncedAt: new Date() })
          .where(eq(material.id, row.materialId));
      });
      updatedCount += 1;
    } catch (error) {
      warnings.push(
        `material:${row.materialId}: ${
          error instanceof Error
            ? error.message
            : "falha ao ler estoque do produto"
        }`,
      );
    }
  }

  const result: RemoteStatusPollResult = {
    processedCount: rows.length,
    updatedCount,
    warnings,
    cursor: {
      cursorType: CONTA_AZUL_PRODUCT_STOCK_CURSOR_TYPE,
      lastRemoteUpdatedAt: null,
      lastSuccessfulPollAt: new Date().toISOString(),
      nextPage: null,
      state: {},
    },
  };

  await inOrgTransaction(params.organizationId, undefined, async (o) => {
    await upsertIntegrationCursor(
      {
        integrationId: params.integrationId,
        organizationId: params.organizationId,
        cursor: result.cursor,
      },
      o,
    );

    await writeIntegrationEvent(
      {
        integrationId: params.integrationId,
        organizationId: params.organizationId,
        level: warnings.length > 0 ? "warning" : "info",
        event: "integration.conta_azul.product_stock_poll.completed",
        message: "Polling de estoque de produtos da Conta Azul concluído",
        details: {
          processedCount: result.processedCount,
          updatedCount: result.updatedCount,
          warnings: result.warnings,
        },
      },
      o,
    );
  });

  return result;
}
