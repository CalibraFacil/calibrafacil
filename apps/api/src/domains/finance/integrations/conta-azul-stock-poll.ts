import { orgDb } from "../../../lib/org-db";
import { reportServerError } from "../../../lib/observability";
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
import type { IntegrationsEnv } from "./integrations-env";
import { getIntegrationRecord, writeIntegrationEvent } from "./records";
import { conflict, DomainError, invalid } from "../../../lib/domain-errors";
import { createContaAzulAdapterForRecord } from "./conta-azul-auth";
import { ContaAzulApiError } from "./conta-azul-client";
import { isContaAzulReconnectRequiredError } from "./errors";
import { CONTA_AZUL_PRODUCT_STOCK_CURSOR_TYPE } from "./constants";
import { upsertIntegrationCursor } from "./conta-azul-schedule-state";
import { requireLabContaAzulIntegration } from "./integration-access";

const ERP_STOCK_NO_INTEGRATION =
  "Nenhuma integração Conta Azul ativa encontrada";
const ERP_STOCK_REFUSED =
  "A Conta Azul não aceitou o ajuste de estoque. Tente novamente em instantes.";

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
    throw invalid("invalid_request", "Quantidade de estoque inválida");
  }

  // The lookups share one transaction; the remote call below runs outside it.
  const { integrationRow, record, link } = await orgDb(
    params.organizationId,
  ).transaction(async (o) => {
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
      throw conflict("integration_inactive", ERP_STOCK_NO_INTEGRATION);
    }

    const record = await getIntegrationRecord(
      params.organizationId,
      integrationRow.integrationId,
      o,
    );
    if (!record) {
      throw conflict("integration_inactive", ERP_STOCK_NO_INTEGRATION);
    }

    const config = normalizeContaAzulConnectionConfig(record.connection.config);
    if (!config.enabledTargets.products) {
      throw conflict(
        "integration_inactive",
        "Sincronização de produtos da Conta Azul está desativada",
      );
    }

    const [link] = await o
      .select({ remoteEntityId: integrationObjectLink.remoteEntityId })
      .from(integrationObjectLink)
      .where(
        and(
          eq(integrationObjectLink.integrationId, integrationRow.integrationId),
          eq(integrationObjectLink.target, "catalog_item"),
          eq(
            integrationObjectLink.localEntityId,
            `material:${params.materialId}`,
          ),
        ),
      )
      .limit(1);
    return { integrationRow, record, link };
  });
  if (!link?.remoteEntityId) {
    throw conflict(
      "conflict",
      "Material não está vinculado a um produto na Conta Azul — sincronize o catálogo antes de ajustar o estoque",
    );
  }
  const remoteEntityId = link.remoteEntityId;

  try {
    const adapter = await createContaAzulAdapterForRecord({
      record,
      env: params.env,
    });
    if (!adapter.setProductStock) {
      throw conflict(
        "conflict",
        "Provider Conta Azul sem suporte a ajuste de estoque",
      );
    }

    await adapter.setProductStock(remoteEntityId, params.quantity);
  } catch (error) {
    // A reconnect request carries the fixed pt-BR text of the refresh-failure
    // policy; a Conta Azul refusal carries the vendor's response text, which
    // the lab does not get. Anything else (a failed query, a code defect)
    // bubbles to the error handler: reported, answered as the opaque 500.
    if (error instanceof DomainError) throw error;
    if (isContaAzulReconnectRequiredError(error)) {
      throw conflict("integration_action_required", error.message);
    }
    if (error instanceof ContaAzulApiError) {
      throw conflict("integration_request_failed", ERP_STOCK_REFUSED);
    }
    throw error;
  }

  const stockSyncedAt = new Date();
  await orgDb(params.organizationId).transaction(async (o) => {
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
  const record = await requireLabContaAzulIntegration(
    params.organizationId,
    params.integrationId,
  );

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
  const rows = await orgDb(params.organizationId).transaction((o) =>
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
      await orgDb(params.organizationId).transaction(async (o) => {
        await o
          .update(material)
          .set({ stockQuantity: quantity, stockSyncedAt: new Date() })
          .where(eq(material.id, row.materialId));
      });
      updatedCount += 1;
    } catch (error) {
      // The warnings reach the response: a vendor refusal or a failed statement
      // gets a fixed text, the cause goes to the redacted reporter.
      if (!(error instanceof ContaAzulApiError)) {
        reportServerError(error, {
          surface: "api",
          tags: {
            step: "material-stock-poll",
            organizationId: params.organizationId,
          },
        });
      }
      warnings.push(
        `material:${row.materialId}: ${
          error instanceof ContaAzulApiError
            ? "consulta de estoque recusada pela Conta Azul"
            : "falha ao atualizar o estoque"
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

  await orgDb(params.organizationId).transaction(async (o) => {
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
