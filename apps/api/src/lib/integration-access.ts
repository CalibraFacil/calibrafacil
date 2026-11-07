import { orgDb } from "./org-db";
import { getIntegrationRecord } from "../modules/integrations";
import { notFound } from "./domain-errors";

/**
 * The laboratory's integration with its connection. Throws 404 when none of
 * this laboratory has the id.
 */
export async function requireLabIntegration(
  organizationId: string,
  integrationId: string,
) {
  const record = await orgDb(organizationId).transaction((o) =>
    getIntegrationRecord(organizationId, integrationId, o),
  );
  if (!record) {
    throw notFound("integration_not_found", "Integração não encontrada");
  }
  return record;
}

/**
 * The laboratory's Conta Azul integration with its connection. Throws 404 when
 * the id names no integration of theirs or one of another provider.
 */
export async function requireLabContaAzulIntegration(
  organizationId: string,
  integrationId: string,
) {
  const record = await orgDb(organizationId).transaction((o) =>
    getIntegrationRecord(organizationId, integrationId, o),
  );
  if (!record || record.integration.provider !== "conta_azul") {
    throw notFound(
      "integration_not_found",
      "Integração Conta Azul não encontrada",
    );
  }
  return record;
}
