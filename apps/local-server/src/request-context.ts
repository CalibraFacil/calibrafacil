import type { LocalDatabase } from "@calibra-facil/local-db";
import { toRecord } from "@calibra-facil/shared/record";
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
  const snapshot = tenantSnapshotFromUnknown(
    database
      .prepare(
        `
SELECT organization_id, active_unit_id, user_id
FROM tenant_snapshot
ORDER BY pulled_at DESC
LIMIT 1
`,
      )
      .get(),
  );

  return {
    organizationId: config.organizationId ?? snapshot?.organization_id ?? null,
    unitId: config.unitId ?? snapshot?.active_unit_id ?? null,
    userId: config.userId ?? snapshot?.user_id ?? null,
  };
}

function tenantSnapshotFromUnknown(value: unknown) {
  const snapshot = toRecord(value);
  const organizationId = snapshot.organization_id;
  const activeUnitId = snapshot.active_unit_id;
  const userId = snapshot.user_id;

  if (typeof organizationId !== "string" || typeof userId !== "string") {
    return undefined;
  }

  return {
    organization_id: organizationId,
    active_unit_id:
      typeof activeUnitId === "number" && Number.isFinite(activeUnitId)
        ? activeUnitId
        : null,
    user_id: userId,
  };
}
