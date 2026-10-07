import { and, eq } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import { integrationOAuthApp } from "@calibra-facil/db/schema";
import { decryptPassword, encryptPassword } from "@calibra-facil/signing";

import {
  buildContaAzulOAuthConfig,
  type ContaAzulAppCredentials,
  ContaAzulAppMissingError,
  type ContaAzulOAuthConfig,
  type ContaAzulOAuthEnv,
  getServerContaAzulCredentials,
  resolveContaAzulRedirectUri,
} from "./conta-azul-oauth";

// A self-hosted server has no shared Conta Azul application, so a laboratory
// registers its own on Conta Azul's developer portal (instant, no review) and
// saves the Client ID and Secret here. A server that sets CONTA_AZUL_CLIENT_ID
// and CONTA_AZUL_CLIENT_SECRET supplies one for every laboratory instead; a
// laboratory's own application takes precedence over it.

export type ContaAzulAppSource = "organization" | "server";

export interface ContaAzulAppSummary {
  source: ContaAzulAppSource | null;
  clientId: string | null;
  clientSecretLast4: string | null;
  redirectUri: string;
  updatedAt: string | null;
}

function getMasterKey(env: ContaAzulOAuthEnv) {
  const key = env.INTEGRATIONS_MASTER_KEY?.trim();
  if (!key) {
    throw new Error("INTEGRATIONS_MASTER_KEY não configurada");
  }
  return key;
}

function organizationAppCondition(organizationId: string) {
  return and(
    eq(integrationOAuthApp.organizationId, organizationId),
    eq(integrationOAuthApp.provider, "conta_azul"),
  );
}

export async function resolveContaAzulAppCredentials(params: {
  organizationId: string;
  env: ContaAzulOAuthEnv;
}): Promise<(ContaAzulAppCredentials & { source: ContaAzulAppSource }) | null> {
  const [row] = await db
    .select({
      clientId: integrationOAuthApp.clientId,
      encryptedClientSecret: integrationOAuthApp.encryptedClientSecret,
      clientSecretIv: integrationOAuthApp.clientSecretIv,
    })
    .from(integrationOAuthApp)
    .where(organizationAppCondition(params.organizationId))
    .limit(1);

  if (row) {
    return {
      source: "organization",
      clientId: row.clientId,
      clientSecret: decryptPassword(
        row.encryptedClientSecret,
        row.clientSecretIv,
        getMasterKey(params.env),
      ),
    };
  }

  const server = getServerContaAzulCredentials(params.env);
  return server ? { source: "server", ...server } : null;
}

/** The OAuth configuration for a laboratory, or null when it has no application. */
export async function resolveContaAzulOAuthConfig(params: {
  organizationId: string;
  env: ContaAzulOAuthEnv;
}): Promise<ContaAzulOAuthConfig | null> {
  const credentials = await resolveContaAzulAppCredentials(params);
  return credentials
    ? buildContaAzulOAuthConfig(credentials, params.env)
    : null;
}

export async function requireContaAzulOAuthConfig(params: {
  organizationId: string;
  env: ContaAzulOAuthEnv;
}): Promise<ContaAzulOAuthConfig> {
  const config = await resolveContaAzulOAuthConfig(params);
  if (!config) {
    throw new ContaAzulAppMissingError();
  }
  return config;
}

/** What settings shows: never the secret, only its last four characters. */
export async function getContaAzulAppSummary(params: {
  organizationId: string;
  env: ContaAzulOAuthEnv;
}): Promise<ContaAzulAppSummary> {
  const redirectUri = resolveContaAzulRedirectUri(params.env);
  const [row] = await db
    .select({
      clientId: integrationOAuthApp.clientId,
      clientSecretLast4: integrationOAuthApp.clientSecretLast4,
      updatedAt: integrationOAuthApp.updatedAt,
    })
    .from(integrationOAuthApp)
    .where(organizationAppCondition(params.organizationId))
    .limit(1);

  if (row) {
    return {
      source: "organization",
      clientId: row.clientId,
      clientSecretLast4: row.clientSecretLast4,
      redirectUri,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  return {
    source: getServerContaAzulCredentials(params.env) ? "server" : null,
    clientId: null,
    clientSecretLast4: null,
    redirectUri,
    updatedAt: null,
  };
}

export async function saveContaAzulAppCredentials(params: {
  organizationId: string;
  actorUserId: string;
  credentials: ContaAzulAppCredentials;
  env: ContaAzulOAuthEnv;
}) {
  const { encryptedPassword, iv } = encryptPassword(
    params.credentials.clientSecret,
    getMasterKey(params.env),
  );
  const values = {
    clientId: params.credentials.clientId,
    encryptedClientSecret: encryptedPassword,
    clientSecretIv: iv,
    clientSecretLast4: params.credentials.clientSecret.slice(-4),
    updatedBy: params.actorUserId,
  };

  await db
    .insert(integrationOAuthApp)
    .values({
      id: crypto.randomUUID(),
      organizationId: params.organizationId,
      provider: "conta_azul",
      ...values,
    })
    .onConflictDoUpdate({
      target: [
        integrationOAuthApp.organizationId,
        integrationOAuthApp.provider,
      ],
      set: { ...values, updatedAt: new Date() },
    });
}

/** Returns whether the laboratory had an application of its own to remove. */
export async function deleteContaAzulAppCredentials(params: {
  organizationId: string;
}): Promise<boolean> {
  const deleted = await db
    .delete(integrationOAuthApp)
    .where(organizationAppCondition(params.organizationId))
    .returning();
  return deleted.length > 0;
}

export { ContaAzulAppMissingError };
