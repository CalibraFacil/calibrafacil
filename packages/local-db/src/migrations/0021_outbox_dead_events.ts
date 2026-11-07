// Permanently refused events get their own outbox state (`dead`) instead of
// staying `failed` with no next attempt, which kept them eligible on every
// cycle and let ~50 of them crowd newer work out of the push page.
//
// - `error_code`: the cloud's rejection code, kept apart from the message.
// - `dead_at` / `discarded_at`: when the event was declared dead, and when a
//   person discarded it (the row stays as the local audit trace).
//
// Older builds recorded every cloud rejection as `failed` with a NULL next
// attempt and `last_error = '<CODE>: <reason>'`. Those rows are classified by
// that stored code: permanent codes become `dead`; the rest keep retrying. The list
// is frozen here, as the permanent codes stood when this migration was last
// edited; a migration never follows the live table.
const permanentCodes = [
  "UNSUPPORTED_SYNC_OPERATION",
  "STATUS_PAYLOAD_MISMATCH",
  "INVALID_DESKTOP_EVENT_PAYLOAD",
  "INVALID_SYNC_COMMAND",
  "SYNC_PERMISSION_DENIED",
  "SYNC_ATTACHMENT_TYPE_NOT_ALLOWED",
  "SYNC_ATTACHMENT_TOO_LARGE",
  "SYNC_ATTACHMENT_INTEGRITY_FAILED",
  "SYNC_ATTACHMENT_UPLOAD_UNSUPPORTED",
  "INVALID_STANDARD_SNAPSHOT",
  "COMPILED_METHOD_SNAPSHOT_INVALID",
  "CALIBRATION_RECORD_INCOMPLETE",
  "OFFICIAL_EXECUTION_FAILED",
  "DOMAIN_VALIDATION_FAILED",
  "TAG_ALREADY_EXISTS",
  "ASSET_NOT_FOUND",
  "ASSET_SPECIFICATION_MISSING",
  "REMOTE_ENTITY_NOT_FOUND",
  "INVALID_STATUS_TRANSITION",
  "STANDARD_NOT_ACTIVE",
  "STANDARD_EXPIRED",
  "STANDARD_SCOPE_MISMATCH",
  "STANDARD_CERTIFIED_VALUES_MISSING",
  "STANDARD_BACKDATE_REASON_REQUIRED",
  "TECHNICIAN_COMPETENCE_MISSING",
  "ATTACHMENT_FILE_MISSING",
  "ATTACHMENT_FILE_CHANGED",
  "ATTACHMENT_UPLOAD_REJECTED",
  "PUSH_REQUEST_REJECTED",
]
  .map((code) => `'${code}'`)
  .join(", ");

export const migration0021OutboxDeadEvents = {
  id: 21,
  name: "outbox_dead_events",
  sql: `
ALTER TABLE outbox ADD COLUMN error_code TEXT;
ALTER TABLE outbox ADD COLUMN dead_at TEXT;
ALTER TABLE outbox ADD COLUMN discarded_at TEXT;

UPDATE outbox
SET error_code = substr(last_error, 1, instr(last_error, ': ') - 1)
WHERE status = 'failed'
  AND next_attempt_at IS NULL
  AND instr(last_error, ': ') > 1
  AND substr(last_error, 1, instr(last_error, ': ') - 1) NOT GLOB '*[^A-Z0-9_]*';

UPDATE outbox
SET status = 'dead',
  dead_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE status = 'failed'
  AND next_attempt_at IS NULL
  AND error_code IN (${permanentCodes});

UPDATE domain_events
SET sync_state = 'dead'
WHERE event_id IN (SELECT event_id FROM outbox WHERE status = 'dead');
`,
};
