import type { OrgDb } from "@calibra-facil/db/for-org";
import { orgDb } from "../../../lib/org-db";
import { notFound } from "../../../lib/domain-errors";
import { getIntegrationRecord } from "./records";

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
 * The laboratory's Conta Azul integration with its connection: the one place
 * that refuses an id that names no integration of theirs, or one of another
 * provider, with the one failure (404 `integration_not_found`). `executor` is
 * the caller's org-bound handle when it is inside a transaction already.
 */
export async function requireLabContaAzulIntegration(
  organizationId: string,
  integrationId: string,
  executor?: OrgDb,
) {
  const record = executor
    ? await getIntegrationRecord(organizationId, integrationId, executor)
    : await orgDb(organizationId).transaction((o) =>
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
