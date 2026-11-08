import { DEFAULT_APP_URL } from "@calibra-facil/config/origin-defaults";
import { conflict } from "../../../lib/domain-errors";
import { HTTPException } from "hono/http-exception";
import { type IntegrationSyncTarget } from "@calibra-facil/shared";
import { requireLabContaAzulIntegration } from "./integration-access";
import type { IntegrationsEnv } from "./integrations-env";
import { type ContaAzulOAuthEnv } from "./conta-azul-oauth";

const GENERIC_HTTP_SYNC_TARGETS = new Set<IntegrationSyncTarget>([
  "customer",
  "service_order",
  "billing_document",
]);

export function assertProviderSupportsSyncTarget(
  provider: string,
  target: IntegrationSyncTarget,
) {
  if (provider === "conta_azul" || GENERIC_HTTP_SYNC_TARGETS.has(target)) {
    return;
  }

  throw new HTTPException(400, {
    message: `Alvo ${target} é suportado apenas pelo provider Conta Azul`,
  });
}

export async function assertActiveContaAzulIntegration(params: {
  organizationId: string;
  integrationId: string;
}) {
  const record = await requireLabContaAzulIntegration(
    params.organizationId,
    params.integrationId,
  );

  if (record.integration.status !== "ACTIVE") {
    throw conflict(
      "integration_inactive",
      "Integração Conta Azul precisa estar ativa para esta operação",
    );
  }
}

export type IntegrationsBindings = IntegrationsEnv & ContaAzulOAuthEnv;

export function buildContaAzulOAuthReturnUrl(
  env: IntegrationsBindings,
  returnTo: string | null,
) {
  const appUrl = typeof env.APP_URL === "string" ? env.APP_URL.trim() : "";
  const baseUrl = appUrl || DEFAULT_APP_URL;
  return new URL(
    returnTo ?? "/dashboard/settings/integrations",
    baseUrl,
  ).toString();
}

/**
 * Build a recoverable redirect for OAuth callback failures so users land back
 * on the integrations page with an error hint instead of a raw 500.
 */
export function buildContaAzulOAuthErrorUrl(
  env: IntegrationsBindings,
  returnTo: string | null,
  reason: "invalid_state" | "exchange_failed" | "app_missing",
) {
  const appUrl = typeof env.APP_URL === "string" ? env.APP_URL.trim() : "";
  const baseUrl = appUrl || DEFAULT_APP_URL;
  const url = new URL(returnTo ?? "/dashboard/settings/integrations", baseUrl);
  url.searchParams.set("contaAzulOAuth", "error");
  url.searchParams.set("reason", reason);
  return url.toString();
}
