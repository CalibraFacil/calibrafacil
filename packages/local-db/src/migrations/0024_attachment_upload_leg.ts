// Offline attachments (roadmap P0-5). Before this build nothing uploaded an
// attachment's file: the cloud acknowledged the `create_local_attachment` event
// as audit-only and the outbox marked the attachment `synced` with `remote_key`
// NULL, so field evidence existed only on this computer while the screen said it
// had been sent.
//
// `attachments.upload_status` now moves pending -> uploaded (the file is on the
// cloud, `remote_key` set) -> synced (the cloud accepted the event), or dead.
// No column is added: the status is free text and `remote_key` already exists.
//
// An attachment a previous build marked synced without a `remote_key` was never
// uploaded. Each one goes back to `pending` with a new queued event (the old
// event stays as it was: it was acknowledged), so the upload leg sends its file.
// The new event carries the original author and device so that it is sent under
// the same user as the rest of that user's queue.
export const migration0024AttachmentUploadLeg = {
  id: 24,
  name: "attachment_upload_leg",
  sql: `
UPDATE attachments
SET upload_status = 'pending'
WHERE upload_status = 'synced'
  AND remote_key IS NULL;

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
)
SELECT
  'event:legacy-attachment:' || attachments.id,
  'attachment',
  attachments.id,
  1,
  'create_local_attachment',
  json_object(
    'attachmentId', attachments.id,
    'entityType', attachments.entity_type,
    'entityId', attachments.entity_id,
    'localPath', attachments.local_path,
    'contentHash', attachments.content_hash,
    'mimeType', attachments.mime_type,
    'sizeBytes', attachments.size_bytes
  ),
  '{}',
  (
    SELECT domain_events.actor_user_id
    FROM domain_events
    WHERE domain_events.aggregate_kind = 'attachment'
      AND domain_events.aggregate_id = attachments.id
    ORDER BY domain_events.sequence ASC
    LIMIT 1
  ),
  COALESCE(
    (
      SELECT domain_events.device_id
      FROM domain_events
      WHERE domain_events.aggregate_kind = 'attachment'
        AND domain_events.aggregate_id = attachments.id
      ORDER BY domain_events.sequence ASC
      LIMIT 1
    ),
    'local'
  ),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  'pending'
FROM attachments
WHERE attachments.upload_status = 'pending'
  AND attachments.remote_key IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM domain_events AS queued
    INNER JOIN outbox ON outbox.event_id = queued.event_id
    WHERE queued.aggregate_kind = 'attachment'
      AND queued.aggregate_id = attachments.id
      AND outbox.status IN ('pending', 'failed', 'conflict', 'dead', 'discarded')
  );

INSERT INTO outbox (
  id,
  event_id,
  operation,
  payload_json,
  idempotency_key,
  status,
  created_at
)
SELECT
  'outbox:legacy-attachment:' || domain_events.aggregate_id,
  domain_events.event_id,
  domain_events.event_type,
  domain_events.payload_json,
  domain_events.device_id || ':' || domain_events.event_id,
  'pending',
  domain_events.occurred_at
FROM domain_events
WHERE domain_events.event_id LIKE 'event:legacy-attachment:%'
  AND NOT EXISTS (
    SELECT 1 FROM outbox WHERE outbox.event_id = domain_events.event_id
  );
`,
};
