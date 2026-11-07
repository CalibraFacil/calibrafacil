import { syncBootstrapResponseSchema } from "@calibra-facil/contracts";

import type { LocalDatabase } from "./database";
import type { LocalDatabasePartition } from "./partitions";

/**
 * Readers of the tenant snapshot: the cloud's bootstrap header, one row per
 * organization this database pulled. Every reader asks for the same row (the
 * latest pulled) through here, so a change to the table or to what "latest"
 * means is made once.
 */

type LatestTenantSnapshotRow = {
  organization_id: string;
  active_unit_id: unknown;
  user_id: string;
  snapshot_json: string;
};

function readLatestTenantSnapshotRow(
  database: LocalDatabase,
): LatestTenantSnapshotRow | null {
  return (
    database
      .prepare<[], LatestTenantSnapshotRow>(
        `
SELECT organization_id, active_unit_id, user_id, snapshot_json
FROM tenant_snapshot
ORDER BY pulled_at DESC
LIMIT 1
`,
      )
      .get() ?? null
  );
}

/** Whether this database was ever bootstrapped (it holds a tenant snapshot). */
export function hasTenantSnapshot(database: LocalDatabase): boolean {
  return readLatestTenantSnapshotRow(database) !== null;
}

/**
 * The account and organization a database's own bootstrap snapshot says it
 * belongs to. `null` when it was never bootstrapped.
 */
export function readLocalTenantIdentity(
  database: LocalDatabase,
): LocalDatabasePartition | null {
  const row = readLatestTenantSnapshotRow(database);
  if (!row?.user_id || !row.organization_id) return null;

  return { userId: row.user_id, organizationId: row.organization_id };
}

/** Who is acting and in which laboratory/unit, as the latest snapshot says. */
export function readLocalTenantContext(database: LocalDatabase): {
  organizationId: string;
  unitId: number | null;
  userId: string;
} | null {
  const row = readLatestTenantSnapshotRow(database);
  if (
    !row ||
    typeof row.organization_id !== "string" ||
    typeof row.user_id !== "string"
  ) {
    return null;
  }

  return {
    organizationId: row.organization_id,
    unitId:
      typeof row.active_unit_id === "number" &&
      Number.isFinite(row.active_unit_id)
        ? row.active_unit_id
        : null,
    userId: row.user_id,
  };
}

/** The bootstrap response the latest snapshot holds, or null when there is none or it does not parse. */
export function getLocalSessionSnapshot(database: LocalDatabase) {
  const row = readLatestTenantSnapshotRow(database);
  if (!row) return null;

  const parsed = parseJson(row.snapshot_json);
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const snapshot = syncBootstrapResponseSchema.safeParse(parsed);
  return snapshot.success ? snapshot.data : null;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
