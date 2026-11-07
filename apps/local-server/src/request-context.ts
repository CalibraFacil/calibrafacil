import {
  readLocalTenantContext,
  type LocalDatabase,
} from "@calibra-facil/local-db";
import type { LocalServerConfig } from "./bootstrap";

/**
 * Who is acting and in which lab: the explicit configuration first, else the
 * latest tenant snapshot pulled from the cloud. Every route and the sync
 * runtime read it through here.
 */
export function getLocalRequestContext(
  config: LocalServerConfig,
  database: LocalDatabase,
) {
  const snapshot = readLocalTenantContext(database);

  return {
    organizationId: config.organizationId ?? snapshot?.organizationId ?? null,
    unitId: config.unitId ?? snapshot?.unitId ?? null,
    userId: config.userId ?? snapshot?.userId ?? null,
  };
}
