import { db } from "@calibra-facil/db";
import {
  integrationConnection,
  integrationObjectLink,
} from "@calibra-facil/db/schema";
import { requireContaAzulOAuthConfig } from "../../lib/conta-azul-app";
import {
  normalizeContaAzulConnectionConfig,
  type ContaAzulReferenceDomain,
} from "@calibra-facil/shared";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { ContaAzulClient } from "../../lib/conta-azul-client";
import { createFinancialErpAdapter } from "../../lib/financial-erp-adapters";
import {
  buildContaAzulRefreshFailurePolicy,
  parseContaAzulTokenBundle,
  refreshContaAzulAccessToken,
  serializeContaAzulTokenBundle,
} from "../../lib/conta-azul-oauth";
import type { IntegrationsEnv } from "../../lib/integrations-env";
import { type GenericConnectionRecord } from "./types";
import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
} from "./credentials";
import {
  getIntegrationRecord,
  markContaAzulReconnectRequired,
  writeIntegrationEvent,
} from "./records";
import { ContaAzulReconnectRequiredError } from "./errors";
import { CONTA_AZUL_TOKEN_REFRESH_SKEW_MS } from "./constants";
import { getExistingLink, upsertLink } from "./sync-state";
import { cacheContaAzulReferenceLinks } from "./reference-links";

async function refreshContaAzulTokenForConnection(params: {
  record: GenericConnectionRecord;
  env: IntegrationsEnv;
}) {
  const tokenBundle = parseContaAzulTokenBundle(
    decryptIntegrationSecret(
      params.record.connection.encryptedSecret,
      params.record.connection.secretIv,
      params.env,
    ),
  );
  let refreshed;
  try {
    refreshed = await refreshContaAzulAccessToken(
      await requireContaAzulOAuthConfig({
        organizationId: params.record.integration.organizationId,
        env: params.env,
      }),
      {
        refreshToken: tokenBundle.refreshToken,
      },
    );
  } catch (error) {
    const failure = buildContaAzulRefreshFailurePolicy(error);

    await markContaAzulReconnectRequired({
      integrationId: params.record.integration.id,
      organizationId: params.record.integration.organizationId,
      message: failure.message,
      details: {
        reason: failure.reason,
      },
    });

    throw new ContaAzulReconnectRequiredError(failure.message);
  }
  const encrypted = encryptIntegrationSecret(
    serializeContaAzulTokenBundle(refreshed),
    params.env,
  );
  const config = normalizeContaAzulConnectionConfig({
    ...params.record.connection.config,
    accessTokenExpiresAt: refreshed.expiresAt,
    scopes: refreshed.scopes,
  });

  await db
    .update(integrationConnection)
    .set({
      credentialType: "oauth2",
      config,
      encryptedSecret: encrypted.encryptedSecret,
      secretIv: encrypted.secretIv,
      updatedAt: new Date(),
    })
    .where(eq(integrationConnection.id, params.record.connection.id));

  params.record.connection.credentialType = "oauth2";
  params.record.connection.config = config;
  params.record.connection.encryptedSecret = encrypted.encryptedSecret;
  params.record.connection.secretIv = encrypted.secretIv;

  await writeIntegrationEvent({
    integrationId: params.record.integration.id,
    organizationId: params.record.integration.organizationId,
    level: "info",
    event: "integration.conta_azul.token_refreshed",
    message: "Token OAuth da Conta Azul renovado",
    details: {
      provider: "conta_azul",
      source: "automatic",
      accessTokenExpiresAt: refreshed.expiresAt,
    },
  });

  return refreshed.accessToken;
}

export function shouldRefreshContaAzulTokenBeforeUse(
  tokenBundle: ReturnType<typeof parseContaAzulTokenBundle>,
  now = new Date(),
) {
  const expiresAtMs = Date.parse(tokenBundle.expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    return true;
  }

  return expiresAtMs - now.getTime() <= CONTA_AZUL_TOKEN_REFRESH_SKEW_MS;
}

async function getContaAzulAccessTokenForRecord(params: {
  record: GenericConnectionRecord;
  env: IntegrationsEnv;
}) {
  const tokenBundle = parseContaAzulTokenBundle(
    decryptIntegrationSecret(
      params.record.connection.encryptedSecret,
      params.record.connection.secretIv,
      params.env,
    ),
  );

  if (shouldRefreshContaAzulTokenBeforeUse(tokenBundle)) {
    return refreshContaAzulTokenForConnection(params);
  }

  return tokenBundle.accessToken;
}

export async function createContaAzulAdapterForRecord(params: {
  record: GenericConnectionRecord;
  env: IntegrationsEnv;
}) {
  const accessToken = await getContaAzulAccessTokenForRecord(params);
  const config = normalizeContaAzulConnectionConfig(
    params.record.connection.config,
  );

  return createFinancialErpAdapter({
    provider: "conta_azul",
    integrationId: params.record.integration.id,
    organizationId: params.record.integration.organizationId,
    config,
    accessToken,
    rateLimitKey: params.record.integration.id,
    links: {
      async getExistingRemoteId({ target, localEntityId }) {
        const existing = await getExistingLink(
          params.record.integration.id,
          target,
          localEntityId,
        );
        return existing?.remoteEntityId ?? null;
      },
      async listLinks({ targets, limit, offset }) {
        return db
          .select({
            target: integrationObjectLink.target,
            localEntityId: integrationObjectLink.localEntityId,
            remoteEntityId: integrationObjectLink.remoteEntityId,
            remoteDisplayId: integrationObjectLink.remoteDisplayId,
            remoteEntityType: integrationObjectLink.remoteEntityType,
            metadata: integrationObjectLink.metadata,
          })
          .from(integrationObjectLink)
          .where(
            and(
              eq(
                integrationObjectLink.integrationId,
                params.record.integration.id,
              ),
              inArray(integrationObjectLink.target, targets),
              isNotNull(integrationObjectLink.remoteEntityId),
            ),
          )
          .orderBy(integrationObjectLink.createdAt)
          .limit(limit)
          .offset(offset);
      },
      async upsertLink({
        target,
        localEntityId,
        remoteEntityId,
        remoteDisplayId,
        remoteEntityType,
        metadata,
      }) {
        await upsertLink({
          integrationId: params.record.integration.id,
          organizationId: params.record.integration.organizationId,
          target,
          localEntityId,
          remoteEntityId,
          remoteDisplayId,
          remoteEntityType,
          metadata,
        });
      },
    },
    async onUnauthorized() {
      return refreshContaAzulTokenForConnection(params);
    },
  });
}

export async function createContaAzulClientForRecord(params: {
  record: GenericConnectionRecord;
  env: IntegrationsEnv;
}) {
  const accessToken = await getContaAzulAccessTokenForRecord(params);
  const config = normalizeContaAzulConnectionConfig(
    params.record.connection.config,
  );

  return new ContaAzulClient({
    accessToken,
    baseUrl: config.baseUrl,
    rateLimitKey: params.record.integration.id,
    async onUnauthorized() {
      return refreshContaAzulTokenForConnection(params);
    },
  });
}

export async function validateContaAzulConnection(params: {
  record: GenericConnectionRecord;
  env: IntegrationsEnv;
}) {
  return (await createContaAzulAdapterForRecord(params)).validateConnection();
}

export async function listContaAzulCatalog(params: {
  integrationId: string;
  organizationId: string;
  env: IntegrationsEnv;
  catalog:
    | "accounts"
    | "categories"
    | "cost-centers"
    | "dre-categories"
    | "product-categories"
    | "product-cest"
    | "product-ecommerce-brands"
    | "product-ecommerce-categories"
    | "product-ncm"
    | "products"
    | "product-units"
    | "sellers"
    | "services"
    | "balances"
    | "transfers";
}) {
  const record = await getIntegrationRecord(
    params.organizationId,
    params.integrationId,
  );

  if (!record || record.integration.provider !== "conta_azul") {
    throw new Error("Integração Conta Azul não encontrada");
  }

  const adapter = await createContaAzulAdapterForRecord({
    record,
    env: params.env,
  });
  if (!adapter.listReferenceData) {
    throw new Error("Catálogo Conta Azul indisponível");
  }

  const domain = (() => {
    switch (params.catalog) {
      case "accounts":
        return "accounts";
      case "balances":
        return "balances";
      case "categories":
        return "categories";
      case "cost-centers":
        return "costCenters";
      case "dre-categories":
        return "dreCategories";
      case "product-categories":
        return "productCategories";
      case "product-cest":
        return "cest";
      case "product-ecommerce-brands":
        return "productEcommerceBrands";
      case "product-ecommerce-categories":
        return "productEcommerceCategories";
      case "product-ncm":
        return "ncm";
      case "products":
        return "products";
      case "product-units":
        return "units";
      case "sellers":
        return "sellers";
      case "services":
        return "serviceCategories";
      case "transfers":
        return "transfers";
    }
  })() satisfies ContaAzulReferenceDomain;

  const page = await adapter.listReferenceData(domain);

  await cacheContaAzulReferenceLinks({
    integrationId: record.integration.id,
    organizationId: record.integration.organizationId,
    domain,
    items: page.items,
  });

  return page;
}
