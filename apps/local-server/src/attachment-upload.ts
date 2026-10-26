import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import {
  SYNC_ATTACHMENT_MAX_BYTES,
  classifyOutboxRejection,
  isKnownOutboxRejectionCode,
  normalizeSyncAttachmentMimeType,
  syncAttachmentCompleteUploadResponseSchema,
  syncAttachmentInitUploadResponseSchema,
  syncAttachmentPayloadSchema,
} from "@calibra-facil/contracts";
import {
  getLocalAttachment,
  markAttachmentUploadDead,
  markAttachmentUploaded,
  markOutboxEventsFailedForRetry,
  type LocalDatabase,
  type PendingOutboxEvent,
} from "@calibra-facil/local-db";
import type { LocalServerConfig } from "./bootstrap";
import { resolveLocalStoragePath } from "./local-storage";

/**
 * The desktop half of the offline attachment upload leg (roadmap P0-5).
 *
 * An attachment is a file on this computer plus a queued `create_local_attachment`
 * event. The event alone tells the cloud nothing about the bytes, and an older
 * build marked the attachment synced as soon as the cloud acknowledged the event,
 * so the file never left the laptop. Now, before an attachment event is pushed:
 *
 *   1. the file is read back and checked against the size and SHA-256 recorded
 *      when it was captured (a file that is gone or changed is a dead attachment)
 *   2. `init-upload` returns a presigned PUT bound to that size and content type
 *   3. the bytes are PUT to the store (no cloud credentials are sent to it)
 *   4. `complete-upload` makes the cloud read the object back and verify it
 *   5. only then is `remote_key` stored (status `uploaded`) and the event pushed;
 *      the attachment becomes `synced` when the cloud accepts the event
 *
 * Failures are sorted into transient (offline, 5xx, rate limit, a session that
 * needs signing in: the event is retried with the outbox's backoff, the whole leg
 * starting over) and permanent (a 4xx that names a refusal, a missing or changed
 * file: the attachment and its event are dead and wait for a person). A step never
 * leaves the attachment looking sent: `uploaded` needs a completed upload and
 * `synced` needs `uploaded`.
 */

/** Large files are slow: a cap per sync run keeps one run from holding the queue for long. */
const MAX_UPLOADS_PER_RUN = 10;
const JSON_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 120_000;

/** HTTP statuses that say "try again later", never "this file is refused". */
const TRANSIENT_STATUSES = new Set([401, 404, 408, 425, 429]);

type UploadFailure = {
  kind: "transient" | "permanent";
  code: string;
  message: string;
};

class AttachmentUploadFailure extends Error {
  readonly failure: UploadFailure;

  constructor(failure: UploadFailure) {
    super(failure.message);
    this.name = "AttachmentUploadFailure";
    this.failure = failure;
  }
}

export type AttachmentUploadContext = {
  config: LocalServerConfig;
  database: LocalDatabase;
  fetchImpl: typeof fetch;
  cloudApiUrl: string;
  /** Adds the cloud credentials to a request to the cloud API (never to the object store). */
  applyCloudAuthHeaders: (headers: Headers) => void;
};

/**
 * The events of a push page that may be sent now. A non-attachment event always
 * may. An attachment event may once its file is on the cloud; otherwise it is
 * left out of this push (and failed for retry, or dead, as the cause decides).
 */
export async function uploadAttachmentsBeforePush(
  context: AttachmentUploadContext,
  events: PendingOutboxEvent[],
): Promise<PendingOutboxEvent[]> {
  const ready: PendingOutboxEvent[] = [];
  let uploads = 0;

  for (const event of events) {
    if (event.operation !== "create_local_attachment") {
      ready.push(event);
      continue;
    }

    const attachment = getLocalAttachment(context.database, event.entityId);
    if (attachment?.uploadStatus === "dead") continue;
    if (attachment?.remoteKey && attachment.uploadStatus !== "pending") {
      // `uploaded` (the cloud holds the bytes) or `synced`: only the event is left.
      ready.push(event);
      continue;
    }
    // The rest of the page waits for the next run rather than one run uploading it all.
    if (uploads >= MAX_UPLOADS_PER_RUN) continue;
    uploads += 1;

    try {
      const remoteKey = await uploadAttachmentFile(context, event);
      markAttachmentUploaded(context.database, event.entityId, remoteKey);
      ready.push(event);
    } catch (error) {
      if (!(error instanceof AttachmentUploadFailure)) throw error;
      recordUploadFailure(context.database, event, error.failure);
    }
  }

  return ready;
}

function recordUploadFailure(
  database: LocalDatabase,
  event: PendingOutboxEvent,
  failure: UploadFailure,
) {
  console.error(
    `[sync] attachment upload for ${event.entityId} ${failure.kind}: ${failure.code}: ${failure.message}`,
  );
  if (failure.kind === "permanent") {
    markAttachmentUploadDead(database, {
      attachmentId: event.entityId,
      eventId: event.eventId,
      code: failure.code,
      message: failure.message,
    });
    return;
  }
  // The outbox's own backoff: the event is not due again until `next_attempt_at`.
  markOutboxEventsFailedForRetry(
    database,
    [event.eventId],
    `${failure.code}: ${failure.message}`,
  );
}

/** Runs the whole leg for one attachment event and returns the cloud's object key. */
async function uploadAttachmentFile(
  context: AttachmentUploadContext,
  event: PendingOutboxEvent,
): Promise<string> {
  const declared = syncAttachmentPayloadSchema.safeParse(event.payload);
  const payload = declared.success ? declared.data : null;
  if (
    !payload?.entityType ||
    !payload.entityId ||
    !payload.localPath ||
    !payload.contentHash ||
    !payload.mimeType ||
    payload.sizeBytes === undefined
  ) {
    throw permanent(
      "ATTACHMENT_UPLOAD_REJECTED",
      "The attachment event does not describe its file.",
    );
  }
  const { entityType, entityId, localPath, contentHash, mimeType, sizeBytes } =
    payload;

  // Refused up front what the cloud would refuse: nothing is read or sent.
  const contentType = normalizeSyncAttachmentMimeType(mimeType);
  if (contentType === null) {
    throw permanent(
      "SYNC_ATTACHMENT_TYPE_NOT_ALLOWED",
      "This file type is not accepted as an offline attachment.",
    );
  }
  if (sizeBytes > SYNC_ATTACHMENT_MAX_BYTES) {
    throw permanent(
      "SYNC_ATTACHMENT_TOO_LARGE",
      `An offline attachment is at most ${SYNC_ATTACHMENT_MAX_BYTES} bytes.`,
    );
  }

  const bytes = await readAttachmentFile(context.config, localPath, sizeBytes);
  if (
    bytes.byteLength !== sizeBytes ||
    createHash("sha256").update(bytes).digest("hex") !== contentHash
  ) {
    throw permanent(
      "ATTACHMENT_FILE_CHANGED",
      "The attachment file is not the one that was recorded when it was captured.",
    );
  }

  const declaration = {
    deviceId: context.config.deviceId,
    eventId: event.eventId,
    entityType,
    entityId,
    contentHash,
    mimeType: contentType,
    sizeBytes,
  };

  const init = syncAttachmentInitUploadResponseSchema.safeParse(
    await postCloudJson(context, "/api/sync/attachments/init-upload", {
      ...declaration,
      fileName: localPath.split("/").pop() ?? "attachment",
    }),
  );
  if (!init.success) {
    throw transient(
      "UNREADABLE_CLOUD_RESPONSE",
      "init-upload answered an unreadable body.",
    );
  }

  await putToObjectStore(context.fetchImpl, init.data, bytes);

  const completed = syncAttachmentCompleteUploadResponseSchema.safeParse(
    await postCloudJson(context, "/api/sync/attachments/complete-upload", {
      ...declaration,
      attachmentId: init.data.attachmentId,
      objectKey: init.data.objectKey,
    }),
  );
  if (!completed.success || !completed.data.ok) {
    throw transient(
      "UNREADABLE_CLOUD_RESPONSE",
      "complete-upload did not confirm the upload.",
    );
  }

  return init.data.objectKey;
}

async function readAttachmentFile(
  config: LocalServerConfig,
  localPath: string,
  expectedSize: number,
): Promise<Buffer> {
  try {
    const absolutePath = resolveLocalStoragePath(config.storageRoot, localPath);
    // The size is checked before the file is read: one that grew (or was swapped
    // for something large) is not loaded into memory to find out it differs.
    const info = await stat(absolutePath);
    if (!info.isFile()) {
      throw permanent(
        "ATTACHMENT_FILE_MISSING",
        "The attachment file is no longer on this computer.",
      );
    }
    if (info.size !== expectedSize) {
      throw permanent(
        "ATTACHMENT_FILE_CHANGED",
        "The attachment file is not the one that was recorded when it was captured.",
      );
    }
    return await readFile(absolutePath);
  } catch (error) {
    if (error instanceof AttachmentUploadFailure) throw error;
    const code =
      error && typeof error === "object" ? Reflect.get(error, "code") : null;
    if (code === "ENOENT" || code === "ENOTDIR") {
      throw permanent(
        "ATTACHMENT_FILE_MISSING",
        "The attachment file is no longer on this computer.",
      );
    }
    if (error instanceof Error && error.message.includes("invalido")) {
      throw permanent(
        "ATTACHMENT_FILE_MISSING",
        "The attachment path is not valid.",
      );
    }
    // Busy, permission or disk trouble: may pass.
    throw transient(
      "ATTACHMENT_FILE_UNREADABLE",
      error instanceof Error
        ? error.message
        : "The attachment file could not be read.",
    );
  }
}

async function postCloudJson(
  context: AttachmentUploadContext,
  path: string,
  body: unknown,
): Promise<unknown> {
  const headers = new Headers({ "Content-Type": "application/json" });
  context.applyCloudAuthHeaders(headers);

  let response: Response;
  try {
    response = await context.fetchImpl(new URL(path, context.cloudApiUrl), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(JSON_TIMEOUT_MS),
    });
  } catch (error) {
    throw transient(
      "CLOUD_UNREACHABLE",
      describe(error, "The cloud could not be reached."),
    );
  }

  if (!response.ok) throw await failureFromResponse(response);
  return response.json().catch(() => null);
}

async function putToObjectStore(
  fetchImpl: typeof fetch,
  init: { uploadUrl: string; headers: Record<string, string> },
  bytes: Buffer,
) {
  // Only the headers the presign was signed with; the length comes from the body.
  const headers = new Headers();
  for (const [name, value] of Object.entries(init.headers)) {
    const lower = name.toLowerCase();
    if (lower === "content-length" || lower === "host") continue;
    headers.set(name, value);
  }

  let response: Response;
  try {
    response = await fetchImpl(init.uploadUrl, {
      method: "PUT",
      headers,
      body: new Uint8Array(bytes),
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
  } catch (error) {
    throw transient(
      "UPLOAD_FAILED",
      describe(error, "The file could not be sent."),
    );
  }

  if (response.ok) return;
  // A 403 is an expired or refused signature: asking for a new URL fixes it.
  if (response.status === 403 || isTransientStatus(response.status)) {
    throw transient(
      "UPLOAD_FAILED",
      `The object store answered HTTP ${response.status}.`,
    );
  }
  throw permanent(
    "ATTACHMENT_UPLOAD_REJECTED",
    `The object store refused the file (HTTP ${response.status}).`,
  );
}

function isTransientStatus(status: number) {
  return status >= 500 || TRANSIENT_STATUSES.has(status);
}

/**
 * A non-2xx answer from the cloud API. A body that names a code is sorted by the
 * outbox rejection table (the same decision as for a pushed event); otherwise by
 * status: sign-in, routing, rate-limit and server trouble retry, any other 4xx is
 * a refusal of this file.
 */
async function failureFromResponse(
  response: Response,
): Promise<AttachmentUploadFailure> {
  const body: unknown = await response.json().catch(() => null);
  const record =
    body && typeof body === "object" && !Array.isArray(body)
      ? Object.fromEntries(Object.entries(body))
      : {};
  // The endpoints answer registry codes (`sync_attachment_not_uploaded`); the
  // outbox table is keyed by the upper-case form of the same refusals.
  const code =
    typeof record.code === "string" &&
    isKnownOutboxRejectionCode(record.code.toUpperCase())
      ? record.code.toUpperCase()
      : null;
  const reason =
    typeof record.error === "string"
      ? record.error
      : `The cloud answered HTTP ${response.status}.`;

  if (code !== null) {
    return new AttachmentUploadFailure({
      kind: classifyOutboxRejection(code),
      code,
      message: reason,
    });
  }
  if (isTransientStatus(response.status)) {
    return transient(
      "CLOUD_UNAVAILABLE",
      `The cloud answered HTTP ${response.status}.`,
    );
  }
  if (response.status === 403) {
    return permanent("SYNC_PERMISSION_DENIED", reason);
  }
  return permanent("ATTACHMENT_UPLOAD_REJECTED", reason);
}

function permanent(code: string, message: string) {
  return new AttachmentUploadFailure({ kind: "permanent", code, message });
}

function transient(code: string, message: string) {
  return new AttachmentUploadFailure({ kind: "transient", code, message });
}

function describe(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
