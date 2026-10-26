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

/**
 * A cloud's answer to the attachment upload leg (init-upload, the PUT to the
 * object store, complete-upload), for a test that syncs a device holding
 * attachments through a fake `fetch`. Null for any other request.
 */
export function answerAttachmentUpload(
  url: string,
  init?: RequestInit,
): Response | null {
  const parsed = new URL(url);
  if (parsed.host === "store.test") return new Response(null, { status: 200 });
  if (!parsed.pathname.startsWith("/api/sync/attachments/")) return null;

  const body: unknown =
    typeof init?.body === "string" ? JSON.parse(init.body) : {};
  const record =
    body && typeof body === "object" && !Array.isArray(body)
      ? Object.fromEntries(Object.entries(body))
      : {};
  const objectKey = `org/org-1/sync-attachments/${String(record.entityType)}/${String(record.entityId)}/${String(record.eventId)}`;
  if (parsed.pathname.endsWith("/init-upload")) {
    return Response.json({
      attachmentId: Buffer.from(objectKey).toString("base64url"),
      objectKey,
      uploadUrl: `https://store.test/${objectKey}`,
      expiresInSeconds: 900,
      headers: { "content-type": String(record.mimeType) },
    });
  }
  return Response.json({
    ok: true,
    attachmentId: String(record.attachmentId),
    objectKey: String(record.objectKey),
    completedAt: new Date().toISOString(),
  });
}
