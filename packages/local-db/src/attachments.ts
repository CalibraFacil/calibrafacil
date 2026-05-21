import { randomUUID } from "node:crypto";
import type { LocalDatabase } from "./database";

export type LocalAttachment = {
  id: string;
  entityType: string;
  entityId: string;
  localPath: string;
  contentHash: string;
  mimeType: string;
  sizeBytes: number;
  remoteKey: string | null;
  uploadStatus: string;
  createdAt: string;
};

export type CreateLocalAttachmentInput = {
  entityType: string;
  entityId: string;
  localPath: string;
  contentHash: string;
  mimeType: string;
  sizeBytes: number;
  actorUserId?: string | null;
  deviceId?: string | null;
};

export function createLocalAttachment(
  database: LocalDatabase,
  input: CreateLocalAttachmentInput,
): LocalAttachment {
  const now = new Date().toISOString();
  const attachmentId = `attachment:${randomUUID()}`;

  database.transaction(() => {
    database
      .prepare(
        `
INSERT INTO attachments (
  id,
  entity_type,
  entity_id,
  local_path,
  content_hash,
  mime_type,
  size_bytes,
  remote_key,
  upload_status,
  created_at
) VALUES (
  @id,
  @entityType,
  @entityId,
  @localPath,
  @contentHash,
  @mimeType,
  @sizeBytes,
  NULL,
  'pending',
  @createdAt
)
`,
      )
      .run({
        id: attachmentId,
        entityType: input.entityType,
        entityId: input.entityId,
        localPath: input.localPath,
        contentHash: input.contentHash,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        createdAt: now,
      });

    appendLocalAudit(database, {
      entityType: "attachment",
      entityId: attachmentId,
      action: "create",
      actorUserId: input.actorUserId,
      details: {
        attachedTo: {
          entityType: input.entityType,
          entityId: input.entityId,
        },
        contentHash: input.contentHash,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
      },
      createdAt: now,
    });
    appendOutboxEvent(database, {
      entityType: "attachment",
      entityId: attachmentId,
      operation: "create_local_attachment",
      payload: {
        attachmentId,
        entityType: input.entityType,
        entityId: input.entityId,
        localPath: input.localPath,
        contentHash: input.contentHash,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
      },
      actorUserId: input.actorUserId,
      deviceId: input.deviceId,
      occurredAt: now,
    });
  })();

  return {
    id: attachmentId,
    entityType: input.entityType,
    entityId: input.entityId,
    localPath: input.localPath,
    contentHash: input.contentHash,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    remoteKey: null,
    uploadStatus: "pending",
    createdAt: now,
  };
}

export function getLocalAttachment(
  database: LocalDatabase,
  attachmentId: string,
): LocalAttachment | null {
  const row = database
    .prepare<{ attachmentId: string }, LocalAttachmentRow>(
      "SELECT * FROM attachments WHERE id = @attachmentId",
    )
    .get({ attachmentId });

  return row ? toLocalAttachment(row) : null;
}

export function listLocalAttachments(
  database: LocalDatabase,
  input: { entityType?: string; entityId?: string; limit?: number } = {},
) {
  const conditions: string[] = [];
  const params: Record<string, string | number> = {
    limit: Math.max(1, Math.min(input.limit ?? 50, 100)),
  };

  if (input.entityType) {
    conditions.push("entity_type = @entityType");
    params.entityType = input.entityType;
  }

  if (input.entityId) {
    conditions.push("entity_id = @entityId");
    params.entityId = input.entityId;
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = database
    .prepare<Record<string, string | number>, LocalAttachmentRow>(
      `
SELECT *
FROM attachments
${whereClause}
ORDER BY created_at DESC
LIMIT @limit
`,
    )
    .all(params);

  return { data: rows.map(toLocalAttachment) };
}

function appendLocalAudit(
  database: LocalDatabase,
  input: {
    entityType: string;
    entityId: string;
    action: string;
    actorUserId?: string | null;
    details: unknown;
    createdAt: string;
  },
) {
  database
    .prepare(
      `
INSERT INTO local_audit_log (
  id,
  entity_type,
  entity_id,
  action,
  actor_user_id,
  details_json,
  created_at,
  sync_state
) VALUES (
  @id,
  @entityType,
  @entityId,
  @action,
  @actorUserId,
  @detailsJson,
  @createdAt,
  'local'
)
`,
    )
    .run({
      id: `audit:${randomUUID()}`,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      actorUserId: input.actorUserId ?? null,
      detailsJson: JSON.stringify(input.details),
      createdAt: input.createdAt,
    });
}

function appendOutboxEvent(
  database: LocalDatabase,
  input: {
    entityType: string;
    entityId: string;
    operation: string;
    payload: unknown;
    actorUserId?: string | null;
    deviceId?: string | null;
    occurredAt: string;
  },
) {
  const eventId = `event:${randomUUID()}`;
  const outboxId = `outbox:${randomUUID()}`;

  database
    .prepare(
      `
INSERT INTO domain_events (
  event_id,
  aggregate_kind,
  aggregate_id,
  aggregate_version,
  event_type,
  payload_json,
  metadata_json,
  actor_user_id,
  device_id,
  occurred_at,
  sync_state
) VALUES (
  @eventId,
  @entityType,
  @entityId,
  1,
  @operation,
  @payloadJson,
  '{}',
  @actorUserId,
  @deviceId,
  @occurredAt,
  'pending'
)
`,
    )
    .run({
      eventId,
      entityType: input.entityType,
      entityId: input.entityId,
      operation: input.operation,
      payloadJson: JSON.stringify(input.payload),
      actorUserId: input.actorUserId ?? null,
      deviceId: input.deviceId ?? "local",
      occurredAt: input.occurredAt,
    });

  database
    .prepare(
      `
INSERT INTO outbox (
  id,
  event_id,
  operation,
  payload_json,
  idempotency_key,
  status,
  created_at
) VALUES (
  @id,
  @eventId,
  @operation,
  @payloadJson,
  @idempotencyKey,
  'pending',
  @createdAt
)
`,
    )
    .run({
      id: outboxId,
      eventId,
      operation: input.operation,
      payloadJson: JSON.stringify(input.payload),
      idempotencyKey: `${input.deviceId ?? "local"}:${eventId}`,
      createdAt: input.occurredAt,
    });
}

function toLocalAttachment(row: LocalAttachmentRow): LocalAttachment {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    localPath: row.local_path,
    contentHash: row.content_hash,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    remoteKey: row.remote_key,
    uploadStatus: row.upload_status,
    createdAt: row.created_at,
  };
}

type LocalAttachmentRow = {
  id: string;
  entity_type: string;
  entity_id: string;
  local_path: string;
  content_hash: string;
  mime_type: string;
  size_bytes: number;
  remote_key: string | null;
  upload_status: string;
  created_at: string;
};
