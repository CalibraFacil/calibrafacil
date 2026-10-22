import type { LocalDatabase } from "@calibra-facil/local-db";

/**
 * Reference data a technician already has on the device after the initial sync:
 * one customer (cloud id 123) and one asset type (cloud id 456). Offline intake
 * (`POST /api/assets`, `POST /api/service-orders`) is written against these.
 */
export function seedSyncedReferenceData(
  database: LocalDatabase,
  input: { organizationId: string; unitId: number; now?: string },
) {
  const now = input.now ?? new Date().toISOString();

  database
    .prepare(
      `
INSERT INTO customers (
  id,
  remote_id,
  organization_id,
  unit_id,
  name,
  updated_at,
  sync_state
) VALUES ('customer:123', 123, @organizationId, @unitId, 'Acme Lab', @now, 'synced')
`,
    )
    .run({ ...input, now });
  database
    .prepare(
      `
INSERT INTO asset_types (
  id,
  remote_id,
  organization_id,
  name,
  pulled_at,
  sync_state
) VALUES ('asset-type:456', 456, @organizationId, 'Balance', @now, 'synced')
`,
    )
    .run({ organizationId: input.organizationId, now });
}

/** The intake write offline mode keeps: a minimal asset stub for a customer. */
export async function createAssetStub(
  app: {
    request: (path: string, init?: RequestInit) => Response | Promise<Response>;
  },
  name: string,
) {
  return app.request("/api/assets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerId: 123,
      assetTypeId: 456,
      name,
      serialNumber: `SN-${name}`,
      tag: `TAG-${name}`,
      status: "ACTIVE",
    }),
  });
}
