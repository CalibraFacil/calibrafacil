import { normalizeGenericFinancialErpConfig } from "@calibra-facil/shared";
import { decryptIntegrationSecret } from "./credentials";
import type { IntegrationsEnv } from "./integrations-env";
import { assertValidMappings } from "./mapping";
import { pushContaAzulTargetRecord, pushTargetRecord } from "./sync-push";
import type { GenericConnectionRecord } from "./types";
import type { IntegrationBillingDocumentPayload } from "@calibra-facil/shared";

/**
 * Pushes one billing document to the integration `record` with the push the
 * sync runs make (`pushTargetRecord` for a generic HTTP ERP,
 * `pushContaAzulTargetRecord` for Conta Azul): credentials, mappings, links,
 * retries and the Conta Azul customer recovery are the run's, not a copy.
 * Returns the remote id.
 */
export async function pushBillingDocument(params: {
  record: GenericConnectionRecord;
  payload: IntegrationBillingDocumentPayload;
  env: IntegrationsEnv;
}): Promise<string | null> {
  const { record, payload } = params;
  if (record.integration.provider !== "generic_http") {
    const pushed = await pushContaAzulTargetRecord({
      record,
      target: "billing_document",
      env: params.env,
      payload,
    });
    return pushed.remoteEntityId;
  }

  const config = normalizeGenericFinancialErpConfig(record.connection.config);
  assertValidMappings(config, "billing_document");
  const pushed = await pushTargetRecord({
    integrationId: record.integration.id,
    organizationId: record.integration.organizationId,
    target: "billing_document",
    config,
    secret: decryptIntegrationSecret(
      record.connection.encryptedSecret,
      record.connection.secretIv,
      params.env,
    ),
    payload,
  });
  return pushed.remoteEntityId;
}
