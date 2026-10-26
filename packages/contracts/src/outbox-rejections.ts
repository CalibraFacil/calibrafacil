/**
 * What a cloud rejection of an outbox event means for the event's future.
 *
 * - `permanent`: the cloud will refuse this exact event every time (an
 *   operation it does not support, a payload it cannot apply, a regulated
 *   refusal such as an expired standard). Retrying it is noise, and while it
 *   stays eligible it crowds newer work out of the 50-event push page. It moves
 *   to the `dead` state, which keeps the code and message and waits for a
 *   person: discard it, or re-queue it once the data behind it is fixed.
 * - `transient`: the outcome can change without anyone touching the event (the
 *   parent record is still on its way, another request is applying it, a
 *   scope or session problem the user can clear). It stays `failed` and is
 *   retried with exponential backoff.
 *
 * This table is the one place the decision lives. The codes are the ones
 * `apps/api/src/routes/sync.ts` puts in a push response's `rejected` list; a
 * spec reads that source and fails when a code is emitted that is not listed
 * here, so a new refusal cannot silently fall into the default.
 *
 * Network failures, HTTP 5xx and rate limits never reach this table: they fail
 * the whole push request, not a single event, and always back off.
 */
export type OutboxRejectionClass = "permanent" | "transient";

export const OUTBOX_REJECTION_CLASSES = {
  // The operation or the payload can never be applied by the cloud.
  UNSUPPORTED_SYNC_OPERATION: "permanent",
  OFFLINE_CERTIFICATE_PUBLICATION_NOT_SUPPORTED: "permanent",
  STATUS_PAYLOAD_MISMATCH: "permanent",
  INVALID_DESKTOP_EVENT_PAYLOAD: "permanent",
  // The event does not fit the typed push protocol (envelope or payload schema).
  INVALID_SYNC_COMMAND: "permanent",
  // The pushing member's role may not do this offline (the online route denies it
  // too). Refused for good: until a person decides (re-queue after a role
  // change, or discard) retrying would only repeat it.
  SYNC_PERMISSION_DENIED: "permanent",
  // The offline attachment upload leg (sync-attachments.ts). What is declared is
  // not something offline capture produces, or the stored bytes are not the
  // declared ones: re-sending the same file will not change that.
  SYNC_ATTACHMENT_TYPE_NOT_ALLOWED: "permanent",
  SYNC_ATTACHMENT_TOO_LARGE: "permanent",
  SYNC_ATTACHMENT_INTEGRITY_FAILED: "permanent",
  // A build that predates the upload leg cannot send the bytes: update, then re-queue.
  SYNC_ATTACHMENT_UPLOAD_UNSUPPORTED: "permanent",
  // The blob is not (or no longer) confirmed on the cloud: the desktop uploads it
  // again before pushing the event once more.
  SYNC_ATTACHMENT_NOT_UPLOADED: "transient",
  INVALID_STANDARD_SNAPSHOT: "permanent",
  COMPILED_METHOD_SNAPSHOT_INVALID: "permanent",
  CALIBRATION_RECORD_INCOMPLETE: "permanent",
  OFFICIAL_EXECUTION_FAILED: "permanent",
  DOMAIN_VALIDATION_FAILED: "permanent",
  TAG_ALREADY_EXISTS: "permanent",
  ASSET_NOT_FOUND: "permanent",
  ASSET_SPECIFICATION_MISSING: "permanent",
  REMOTE_ENTITY_NOT_FOUND: "permanent",
  INVALID_STATUS_TRANSITION: "permanent",
  // Regulated refusals: the record is not valid against the laboratory's
  // standards or competences, whatever the number of attempts.
  STANDARD_NOT_ACTIVE: "permanent",
  STANDARD_EXPIRED: "permanent",
  STANDARD_SCOPE_MISMATCH: "permanent",
  STANDARD_CERTIFIED_VALUES_MISSING: "permanent",
  STANDARD_BACKDATE_REASON_REQUIRED: "permanent",
  TECHNICIAN_COMPETENCE_MISSING: "permanent",
  // Can change on its own, or with a sign-in / membership change.
  SYNC_EVENT_IN_PROGRESS: "transient",
  DESKTOP_SYNC_APPLY_FAILED: "transient",
  // The parent record's event is still queued (or backing off) ahead of this one.
  REMOTE_ENTITY_MAPPING_MISSING: "transient",
  ORGANIZATION_SCOPE_MISMATCH: "transient",
  UNIT_SCOPE_MISMATCH: "transient",
  ACTOR_SCOPE_MISMATCH: "transient",
  // Answered as a reviewable conflict, never as a refusal; listed so that every
  // code the route emits has a decision.
  STALE_BASE_VERSION: "transient",
} as const satisfies Record<string, OutboxRejectionClass>;

/**
 * Failures the desktop itself records on an event it cannot send (no cloud
 * answer is involved, so the API never emits them and the spec that compares
 * the table with the API does not list them). All permanent: the file behind the
 * attachment is gone or is no longer the file that was recorded, or the cloud
 * refused the upload with a 4xx that names no code.
 */
export const LOCAL_OUTBOX_FAILURE_CLASSES = {
  ATTACHMENT_FILE_MISSING: "permanent",
  ATTACHMENT_FILE_CHANGED: "permanent",
  ATTACHMENT_UPLOAD_REJECTED: "permanent",
} as const satisfies Record<string, OutboxRejectionClass>;

/**
 * A code the desktop does not know (a newer cloud, an older desktop) is
 * transient: backing off is always safe, whereas declaring unknown work dead
 * would hide regulated records behind a decision nobody made.
 */
export function classifyOutboxRejection(code: string): OutboxRejectionClass {
  const known = Object.entries({
    ...OUTBOX_REJECTION_CLASSES,
    ...LOCAL_OUTBOX_FAILURE_CLASSES,
  }).find(([knownCode]) => knownCode === code);
  return known?.[1] ?? "transient";
}

/** Whether the table (cloud rejections or the desktop's own failures) has a decision for `code`. */
export function isKnownOutboxRejectionCode(code: string): boolean {
  return (
    Object.hasOwn(OUTBOX_REJECTION_CLASSES, code) ||
    Object.hasOwn(LOCAL_OUTBOX_FAILURE_CLASSES, code)
  );
}

export const PERMANENT_OUTBOX_REJECTION_CODES: readonly string[] =
  Object.entries({
    ...OUTBOX_REJECTION_CLASSES,
    ...LOCAL_OUTBOX_FAILURE_CLASSES,
  })
    .filter(([, rejectionClass]) => rejectionClass === "permanent")
    .map(([code]) => code);

/**
 * `outbox.last_error` stores a rejection as `<CODE>: <reason>`. Returns the
 * code, or null for a free-text error (a network failure message).
 */
export function parseOutboxErrorCode(lastError: string | null): string | null {
  if (lastError === null) return null;
  const match = /^([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*): /.exec(lastError);
  return match?.[1] ?? null;
}

/** Operations whose events carry regulated calibration readings. */
const REGULATED_OUTBOX_OPERATIONS: readonly string[] = [
  "submit_local_execution",
  "save_local_execution",
];

export function isRegulatedOutboxOperation(operation: string): boolean {
  return REGULATED_OUTBOX_OPERATIONS.includes(operation);
}
